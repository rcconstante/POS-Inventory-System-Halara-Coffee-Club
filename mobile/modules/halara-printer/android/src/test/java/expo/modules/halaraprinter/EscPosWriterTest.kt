package expo.modules.halaraprinter

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.OutputStream
import org.junit.Assert.*
import org.junit.Test

class EscPosWriterTest {
  private class RecordingStream : OutputStream() {
    val packets = mutableListOf<ByteArray>()
    var flushes = 0
    override fun write(value: Int) { throw AssertionError("Commands must be written as complete packets") }
    override fun write(value: ByteArray) { packets.add(value.copyOf()) }
    override fun flush() { flushes++ }
  }

  @Test fun rasterBandsPreserveEveryByteAndDeclareTheExactPayloadLength() {
    val output = RecordingStream()
    val pauses = mutableListOf<Long>()
    val pixels = ByteArray(72 * 43) { ((it * 37) and 255).toByte() }
    EscPosWriter(output) { pauses.add(it) }.raster(72, 43, pixels)
    val recovered = ByteArrayOutputStream()
    var rows = 0
    for (packet in output.packets) {
      assertArrayEquals(byteArrayOf(0x1d, 0x76, 0x30, 0), packet.copyOfRange(0, 4))
      val width = (packet[4].toInt() and 255) + ((packet[5].toInt() and 255) shl 8)
      val height = (packet[6].toInt() and 255) + ((packet[7].toInt() and 255) shl 8)
      assertEquals(72, width)
      assertTrue(height in 1..8)
      assertEquals(8 + width * height, packet.size)
      assertTrue(packet.size <= 584)
      recovered.write(packet, 8, packet.size - 8)
      rows += height
    }
    assertEquals(43, rows)
    assertArrayEquals(pixels, recovered.toByteArray())
    assertEquals(6, output.packets.size)
    assertEquals(output.packets.size, output.flushes)
    assertEquals(List(6) { 60L }, pauses)
  }

  @Test fun tearFeedUsesExactDotsAndNeverSendsACutterCommand() {
    val output = RecordingStream()
    val writer = EscPosWriter(output) {}
    writer.initialize()
    writer.feed(160)
    writer.feed(160)
    writer.feed(320)
    assertArrayEquals(byteArrayOf(0x1b, 0x40), output.packets.first())
    assertEquals(listOf(160, 160, 255, 65), output.packets.drop(1).map { packet ->
      assertEquals(3, packet.size)
      assertEquals(0x1b, packet[0].toInt())
      assertEquals(0x4a, packet[1].toInt())
      packet[2].toInt() and 255
    })
  }

  @Test fun malformedRasterIsRejectedBeforeAnyBytesAreSent() {
    val output = RecordingStream()
    val writer = EscPosWriter(output) {}
    for ((width, height, data) in listOf(Triple(72, 8, ByteArray(575)), Triple(73, 1, ByteArray(73)), Triple(72, 0, byteArrayOf()))) {
      assertThrows(IllegalArgumentException::class.java) { writer.raster(width, height, data) }
    }
    assertTrue(output.packets.isEmpty())
  }

  @Test fun failedWriteStopsWithoutSendingOrRetryingLaterBands() {
    var writes = 0
    val output = object : OutputStream() {
      override fun write(value: Int) { throw AssertionError() }
      override fun write(value: ByteArray) { writes++; throw IOException("Disconnected") }
    }
    assertThrows(IOException::class.java) { EscPosWriter(output) {}.raster(72, 24, ByteArray(72 * 24)) }
    assertEquals(1, writes)
  }
}
