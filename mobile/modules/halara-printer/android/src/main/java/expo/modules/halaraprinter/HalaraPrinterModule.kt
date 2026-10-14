package expo.modules.halaraprinter

import android.Manifest
import android.app.AlertDialog
import android.bluetooth.BluetoothAdapter
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
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class HalaraPrinterModule : Module() {
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
  override fun definition() = ModuleDefinition {
    Name("HalaraPrinter")
    AsyncFunction("savedPrinter") {
      val address = savedAddress()
      if (address == null) null else adapter().bondedDevices.firstOrNull { it.address == address }?.let {
        mapOf("name" to (it.name ?: "Receipt printer"), "address" to it.address)
      }
    }
    AsyncFunction("selectPrinter") { promise: Promise ->
      try {
        val devices = adapter().bondedDevices.filter { it.type != android.bluetooth.BluetoothDevice.DEVICE_TYPE_LE }.sortedBy { it.name ?: it.address }
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
            val labels = devices.map { "${it.name ?: "Bluetooth device"}\n${it.address}" }.toTypedArray()
            AlertDialog.Builder(activity).setTitle("Choose your 80mm receipt printer")
              .setItems(labels) { _, index ->
                val device = devices[index]
                context().getSharedPreferences("halara-printer", Context.MODE_PRIVATE).edit().putString("address", device.address).apply()
                promise.resolve(mapOf("name" to (device.name ?: "Receipt printer"), "address" to device.address))
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
        val device = adapter().bondedDevices.firstOrNull { it.address == address }
          ?: throw IllegalStateException("The saved printer is no longer paired. Open Receipt printer setup.")
        val socket = device.createRfcommSocketToServiceRecord(UUID.fromString("00001101-0000-1000-8000-00805f9b34fb"))
        activeSocket = socket
        val timeout = timer.schedule({ try { socket.close() } catch (_: IOException) {} }, 45, TimeUnit.SECONDS)
        var startedWriting = false
        try {
          socket.connect()
          startedWriting = true
          ReceiptRenderer.print(receipt, socket.outputStream)
          socket.outputStream.flush()
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
