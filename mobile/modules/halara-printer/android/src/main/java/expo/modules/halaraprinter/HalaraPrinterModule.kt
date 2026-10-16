package expo.modules.halaraprinter

import android.Manifest
import android.app.AlertDialog
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.IOException
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

class HalaraPrinterModule : Module() {
  private data class PairedPrinter(val device: BluetoothDevice, val name: String, val address: String)
  private val printLock = Any()
  private val timer = Executors.newSingleThreadScheduledExecutor()
  @Volatile private var activeSocket: BluetoothSocket? = null
  private fun context(): Context = appContext.reactContext ?: throw IllegalStateException("The app is not ready. Reopen the POS.")
  private fun adapter(): BluetoothAdapter {
    val context = context()
    if (Build.VERSION.SDK_INT >= 31 && context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
      throw IllegalStateException("Allow Nearby devices permission to connect the receipt printer.")
    }
    val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    val adapter = manager.adapter ?: throw IllegalStateException("This device does not support Bluetooth.")
    check(adapter.isEnabled) { "Turn on Bluetooth in Android Settings, then retry printing." }
    return adapter
  }
  private fun savedAddress(): String? = context().getSharedPreferences("halara-printer", Context.MODE_PRIVATE).getString("address", null)
  private fun pairedPrinters(): List<PairedPrinter> {
    try {
      return adapter().bondedDevices
        .filter { it.type != BluetoothDevice.DEVICE_TYPE_LE }
        .map { PairedPrinter(it, it.name ?: "Receipt printer", it.address) }
        .sortedBy { it.name }
    } catch (error: SecurityException) {
      throw IllegalStateException("Allow Nearby devices permission in Android Settings, then retry printer setup.", error)
    }
  }
  override fun definition() = ModuleDefinition {
    Name("HalaraPrinter")
    AsyncFunction("savedPrinter") {
      val address = savedAddress()
      if (address == null) null else pairedPrinters().firstOrNull { it.address == address }?.let {
        mapOf("name" to it.name, "address" to it.address)
      }
    }
    AsyncFunction("selectPrinter") { promise: Promise ->
      try {
        val devices = pairedPrinters()
        val activity = appContext.currentActivity ?: throw IllegalStateException("Open the app before choosing a printer.")
        activity.runOnUiThread {
          if (devices.isEmpty()) {
            AlertDialog.Builder(activity).setTitle("Pair your receipt printer")
              .setMessage("Pair the RP30A-UB in Android Bluetooth settings, then return to Receipt printer setup.")
              .setPositiveButton("Bluetooth settings") { _, _ ->
                activity.startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
                promise.reject("PRINTER_NOT_PAIRED", "Pair your printer, return to the POS and select it in Printer setup.", null)
              }
              .setNegativeButton("Cancel") { _, _ -> promise.reject("PRINTER_CANCELLED", "Printer selection cancelled.", null) }
              .setOnCancelListener { promise.reject("PRINTER_CANCELLED", "Printer selection cancelled.", null) }.show()
          } else {
            val labels = devices.map { "${it.name}\n${it.address}" }.toTypedArray()
            AlertDialog.Builder(activity).setTitle("Choose your 80mm receipt printer")
              .setItems(labels) { _, index ->
                val device = devices[index]
                context().getSharedPreferences("halara-printer", Context.MODE_PRIVATE).edit().putString("address", device.address).apply()
                promise.resolve(mapOf("name" to device.name, "address" to device.address))
              }
              .setNegativeButton("Cancel") { _, _ -> promise.reject("PRINTER_CANCELLED", "Printer selection cancelled.", null) }
              .setOnCancelListener { promise.reject("PRINTER_CANCELLED", "Printer selection cancelled.", null) }.show()
          }
        }
      } catch (error: Exception) { promise.reject("PRINTER_SETUP_FAILED", error.message, error) }
    }
    AsyncFunction("printReceipt") { receiptJson: String ->
      val receipt = ReceiptData.parse(receiptJson)
      synchronized(printLock) {
        val address = savedAddress() ?: throw IllegalStateException("Select a receipt printer first.")
        val device = pairedPrinters().firstOrNull { it.address == address }?.device
          ?: throw IllegalStateException("The saved printer is no longer paired. Open Receipt printer setup.")
        val socket = device.createRfcommSocketToServiceRecord(UUID.fromString("00001101-0000-1000-8000-00805f9b34fb"))
        activeSocket = socket
        val startedAt = System.nanoTime()
        val lastWrite = AtomicLong(startedAt)
        // A long, progressing receipt must not be cut off by the connection timeout.
        val timeout = timer.scheduleWithFixedDelay({
          val now = System.nanoTime()
          if (now - lastWrite.get() >= TimeUnit.SECONDS.toNanos(45) || now - startedAt >= TimeUnit.MINUTES.toNanos(15)) {
            try { socket.close() } catch (_: IOException) {}
          }
        }, 1, 1, TimeUnit.SECONDS)
        var startedWriting = false
        try {
          socket.connect()
          startedWriting = true
          lastWrite.set(System.nanoTime())
          val destination = socket.outputStream
          val output = object : OutputStream() {
            override fun write(value: Int) { destination.write(value); lastWrite.set(System.nanoTime()) }
            override fun write(bytes: ByteArray, offset: Int, length: Int) {
              destination.write(bytes, offset, length)
              lastWrite.set(System.nanoTime())
            }
            override fun flush() { destination.flush() }
          }
          ReceiptRenderer.print(receipt, output)
          output.flush()
        } catch (error: SecurityException) {
          throw IllegalStateException("Allow Nearby devices permission in Android Settings before printing.", error)
        } catch (error: IOException) {
          val message = if (startedWriting) "Receipt transmission was interrupted. Check the paper before reprinting; the receipt may be partial."
            else "Could not connect to the receipt printer. Check power, Bluetooth pairing, and whether another app is using it."
          throw IOException(message, error)
        } finally {
          timeout.cancel(false)
          try { socket.close() } catch (_: IOException) {}
          activeSocket = null
        }
      }
    }
    OnDestroy {
      try { activeSocket?.close() } catch (_: IOException) {}
      timer.shutdownNow()
    }
  }
}
