package expo.modules.halaraprinter

import java.io.IOException
import java.io.OutputStream

/** Bound each raster command and pace it for small Bluetooth printer buffers. */
internal class EscPosWriter(
  private val output: OutputStream,
  private val pause: (Long) -> Unit = { Thread.sleep(it) }
) {
  fun initialize() = send(byteArrayOf(0x1b, 0x40))

  fun raster(widthBytes: Int, height: Int, pixels: ByteArray) {
    require(widthBytes in 1..72 && height > 0 && pixels.size.toLong() == widthBytes.toLong() * height)
    var row = 0
    while (row < height) {
      val rows = minOf(8, height - row)
      val packet = ByteArray(8 + widthBytes * rows)
      byteArrayOf(0x1d, 0x76, 0x30, 0x00, widthBytes.toByte(), 0, rows.toByte(), 0).copyInto(packet)
      pixels.copyInto(packet, 8, row * widthBytes, (row + rows) * widthBytes)
      send(packet)
      row += rows
    }
  }

  /** Explicit dots avoid depending on the printer's current text line spacing. */
  fun feed(dots: Int) {
    require(dots in 1..2048)
    var remaining = dots
    while (remaining > 0) {
      val count = minOf(255, remaining)
      send(byteArrayOf(0x1b, 0x4a, count.toByte()))
      remaining -= count
    }
  }

  private fun send(packet: ByteArray) {
    output.write(packet)
    output.flush()
    try {
      // At most 584 bytes per raster command, below 10 KB/s, with no overlapping jobs.
      pause(60)
    } catch (error: InterruptedException) {
      Thread.currentThread().interrupt()
      throw IOException("Receipt transmission interrupted. Check the paper before reprinting.", error)
    }
  }
}
