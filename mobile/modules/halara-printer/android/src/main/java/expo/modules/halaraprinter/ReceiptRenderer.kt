package expo.modules.halaraprinter

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import org.json.JSONObject
import java.io.OutputStream
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.ceil

data class ReceiptItem(val name: String, val quantity: Long, val unitPrice: Long)
data class ReceiptData(
  val receipt: String, val status: String, val dateTime: String, val cashier: String,
  val payment: String, val total: Long, val cashReceived: Long?, val change: Long?, val items: List<ReceiptItem>
) {
  companion object {
    fun parse(raw: String): ReceiptData {
      require(raw.length <= 100_000) { "The receipt is too large." }
      val json = JSONObject(raw)
      fun text(key: String, maximum: Int): String {
        val value = json.getString(key)
        require(value.isNotBlank() && value.length <= maximum) { "Invalid receipt field: $key" }
        return value.replace(Regex("[\\p{Cntrl}]"), " ")
      }
      fun amount(value: Long): Long {
        require(value in 0..1_000_000_000_000L) { "Invalid receipt amount." }
        return value
      }
      val array = json.getJSONArray("items")
      require(array.length() in 1..250) { "Invalid receipt item count." }
      val items = (0 until array.length()).map { index ->
        val item = array.getJSONObject(index)
        val name = item.getString("name")
        val quantity = item.getLong("quantity")
        require(name.isNotBlank() && name.length <= 300 && quantity in 1..100_000) { "Invalid receipt item." }
        ReceiptItem(name.replace(Regex("[\\p{Cntrl}]"), " "), quantity, amount(item.getLong("unitPriceCentavos")))
      }
      val total = amount(json.getLong("totalCentavos"))
      require(items.sumOf { it.quantity * it.unitPrice } == total) { "Receipt total does not match its items." }
      val payment = text("payment", 10)
      require(payment in listOf("Cash", "GCash", "Maya")) { "Invalid payment method." }
      val status = text("status", 10)
      require(status in listOf("Completed", "Cancelled")) { "Invalid sale status." }
      val cashReceived = if (payment == "Cash") amount(json.getLong("cashReceivedCentavos")) else null
      val change = if (payment == "Cash") amount(json.getLong("changeCentavos")) else null
      if (cashReceived != null && change != null) require(cashReceived - total == change) { "Invalid receipt change." }
      return ReceiptData(text("receipt", 80), status, text("dateTime", 100), text("cashier", 200), payment, total, cashReceived, change, items)
    }
  }
}

/** Raster text preserves Unicode without relying on printer-specific character pages. */
object ReceiptRenderer {
  private const val WIDTH = 576
  private const val PADDING = 12f

  fun print(receipt: ReceiptData, output: OutputStream) {
    output.write(byteArrayOf(0x1b, 0x40))
    val format = NumberFormat.getNumberInstance(Locale.US).apply { minimumFractionDigits = 2; maximumFractionDigits = 2 }
    fun money(value: Long): String = "PHP ${format.format(value / 100.0)}"
    for (copy in listOf("CUSTOMER COPY", "STORE COPY")) {
      row(output, "HALARA COFFEE CLUB", bold = true, centered = true, size = 30f)
      row(output, "Official Sales Receipt", centered = true)
      row(output, copy, bold = true, centered = true)
      if (receipt.status == "Cancelled") row(output, "CANCELLED", bold = true, centered = true, size = 30f)
      rule(output)
      wrapped(output, "Receipt: ${receipt.receipt}")
      wrapped(output, "Date / time: ${receipt.dateTime}")
      wrapped(output, "Cashier: ${receipt.cashier}")
      rule(output)
      for (item in receipt.items) {
        wrapped(output, "${item.quantity} × ${item.name}", bold = true)
        row(output, "${money(item.unitPrice)} each", right = money(item.quantity * item.unitPrice))
      }
      rule(output)
      row(output, "Total", right = money(receipt.total), bold = true, size = 28f)
      row(output, "Payment", right = receipt.payment)
      receipt.cashReceived?.let { row(output, "Cash received", right = money(it)) }
      receipt.change?.let { row(output, "Change", right = money(it)) }
      wrapped(output, "Thank you for visiting Halara Coffee Club.", centered = true)
      output.write(byteArrayOf(0x1b, 0x64, 0x03))
      if (copy == "CUSTOMER COPY") { rule(output); row(output, "CUT HERE", centered = true); rule(output) }
    }
    output.write(byteArrayOf(0x1b, 0x64, 0x04))
  }

  private fun paint(bold: Boolean, size: Float): Paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.BLACK; textSize = size
    typeface = Typeface.create("sans-serif", if (bold) Typeface.BOLD else Typeface.NORMAL)
  }

  private fun wrapped(output: OutputStream, text: String, bold: Boolean = false, centered: Boolean = false) {
    val paint = paint(bold, 24f)
    var remaining = text.trim()
    while (remaining.isNotEmpty()) {
      var count = paint.breakText(remaining, true, WIDTH - PADDING * 2, null).coerceAtLeast(1)
      if (count < remaining.length) {
        val space = remaining.lastIndexOf(' ', count - 1)
        if (space > 0) count = space
      }
      row(output, remaining.take(count), bold = bold, centered = centered)
      remaining = remaining.drop(count).trimStart()
    }
  }

  private fun row(output: OutputStream, text: String, right: String? = null, bold: Boolean = false, centered: Boolean = false, size: Float = 24f) {
    val paint = paint(bold, size)
    if (right != null && paint.measureText(text) + paint.measureText(right) + PADDING * 3 > WIDTH) {
      wrapped(output, text, bold)
      row(output, right, bold = bold, size = size)
      return
    }
    val height = ceil(paint.fontSpacing.toDouble()).toInt() + 12
    val bitmap = Bitmap.createBitmap(WIDTH, height, Bitmap.Config.ARGB_8888)
    try {
      val canvas = Canvas(bitmap); canvas.drawColor(Color.WHITE)
      val x = if (centered) (WIDTH - paint.measureText(text)) / 2 else PADDING
      canvas.drawText(text, x, 6f - paint.fontMetrics.top, paint)
      if (right != null) canvas.drawText(right, WIDTH - PADDING - paint.measureText(right), 6f - paint.fontMetrics.top, paint)
      raster(output, bitmap)
    } finally { bitmap.recycle() }
  }

  private fun rule(output: OutputStream) {
    val bitmap = Bitmap.createBitmap(WIDTH, 12, Bitmap.Config.ARGB_8888)
    try {
      val canvas = Canvas(bitmap); canvas.drawColor(Color.WHITE)
      val paint = Paint().apply { color = Color.BLACK; strokeWidth = 2f }
      canvas.drawLine(PADDING, 6f, WIDTH - PADDING, 6f, paint)
      raster(output, bitmap)
    } finally { bitmap.recycle() }
  }

  private fun raster(output: OutputStream, bitmap: Bitmap) {
    val widthBytes = WIDTH / 8
    val data = ByteArray(widthBytes * bitmap.height)
    for (y in 0 until bitmap.height) for (x in 0 until WIDTH) {
      if (Color.red(bitmap.getPixel(x, y)) < 128) {
        val index = y * widthBytes + x / 8
        data[index] = (data[index].toInt() or (0x80 shr (x % 8))).toByte()
      }
    }
    output.write(byteArrayOf(0x1d, 0x76, 0x30, 0x00, widthBytes.toByte(), 0, (bitmap.height and 255).toByte(), (bitmap.height shr 8).toByte()))
    output.write(data)
  }
}
