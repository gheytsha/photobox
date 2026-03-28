/* gif.js - GIF Encoder Library (Optimized for Grayscale)
 * Uses fixed grayscale palette for fast encoding
 */
(function() {
  'use strict';

  function GIF(options) {
    this.options = Object.assign({
      workers: 2,
      quality: 10,
      width: null,
      height: null,
      transparent: null,
      repeat: 0,
      workerScript: 'gif.worker.js',
      dither: false,
    }, options);

    if (this.options.width == null || this.options.height == null) {
      throw new Error('Width and height must be specified');
    }

    this.width = ~~this.options.width;
    this.height = ~~this.options.height;
    this.frames = [];
    this.running = false;
    this.listeners = { finished: [], progress: [] };

    // Pre-compute fixed grayscale palette (256 levels)
    this.grayscalePalette = [];
    for (var i = 0; i < 256; i++) {
      this.grayscalePalette.push([i, i, i]);
    }
  }

  GIF.prototype = {
    addFrame: function(image, options) {
      var frame = Object.assign({
        delay: 100,
        copy: false,
        dispose: -1,
      }, options);

      if (frame.copy) {
        var canvas = document.createElement('canvas');
        canvas.width = this.width;
        canvas.height = this.height;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, this.width, this.height);
        frame.data = ctx.getImageData(0, 0, this.width, this.height);
      } else if (image instanceof ImageData) {
        frame.data = image;
      } else if (image.getContext) {
        frame.data = image.getContext('2d').getImageData(0, 0, this.width, this.height);
      } else {
        throw new Error('Invalid image type');
      }

      this.frames.push(frame);
    },

    on: function(event, fn) {
      if (this.listeners[event]) {
        this.listeners[event].push(fn);
      }
    },

    emit: function(event, data) {
      if (this.listeners[event]) {
        this.listeners[event].forEach(function(fn) { fn(data); });
      }
    },

    render: function() {
      if (this.running) throw new Error('Already rendering');
      this.running = true;

      var self = this;

      // Process asynchronously to not block UI
      setTimeout(function() {
        try {
          var frameData = self.processFramesSync();
          var buffer = self.encodeGIF(frameData);
          var blob = new Blob([buffer], { type: 'image/gif' });
          self.running = false;
          self.emit('finished', blob);
        } catch (err) {
          console.error('GIF render error:', err);
          self.running = false;
        }
      }, 50);
    },

    processFramesSync: function() {
      var result = [];
      var palette = this.grayscalePalette;

      for (var i = 0; i < this.frames.length; i++) {
        var pixels = this.frames[i].data.data;
        var indices = this.quantizeFast(pixels);
        result.push({
          indices: indices,
          delay: this.frames[i].delay,
          palette: palette,
        });
        this.emit('progress', (i + 1) / this.frames.length);
      }

      return result;
    },

    // Fast grayscale quantization - just use luminance as palette index
    quantizeFast: function(pixels) {
      var len = pixels.length / 4;
      var indices = new Uint8Array(len);
      for (var j = 0; j < len; j++) {
        var offset = j * 4;
        // Luminance formula -> 0-255 index
        indices[j] = Math.round(pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114);
      }
      return indices;
    },

    encodeGIF: function(frameDataArray) {
      var w = this.width;
      var h = this.height;
      var palette = this.grayscalePalette;
      var paletteSize = 256; // 2^8

      // Calculate total buffer size needed
      var estimatedSize = 13 + paletteSize * 3 + 19 + frameDataArray.length * (19 + w * h);
      var buf = new Uint8Array(estimatedSize);
      var pos = 0;

      function writeByte(b) { buf[pos++] = b; }
      function writeU16(v) { writeByte(v & 0xFF); writeByte((v >> 8) & 0xFF); }
      function writeStr(s) { for (var i = 0; i < s.length; i++) writeByte(s.charCodeAt(i)); }

      // Header: GIF89a
      writeStr('GIF89a');

      // Logical Screen Descriptor
      writeU16(w);
      writeU16(h);
      writeByte(0x80 | 0x70 | 0x07); // GCT flag=1, colorRes=7, sort=0, GCTsize=7 (256 entries)
      writeByte(0x00); // bg color index
      writeByte(0x00); // pixel aspect ratio

      // Global Color Table (256 grayscale entries)
      for (var p = 0; p < 256; p++) {
        writeByte(p); // R
        writeByte(p); // G
        writeByte(p); // B
      }

      // Netscape Extension for infinite loop
      writeByte(0x21);
      writeByte(0xFF);
      writeByte(0x0B);
      writeStr('NETSCAPE2.0');
      writeByte(0x03);
      writeByte(0x01);
      writeU16(this.options.repeat);
      writeByte(0x00);

      // Write each frame
      for (var f = 0; f < frameDataArray.length; f++) {
        var frame = frameDataArray[f];
        var delay = Math.round(frame.delay / 10); // in 1/100th sec

        // Graphics Control Extension
        writeByte(0x21);
        writeByte(0xF9);
        writeByte(0x04);
        writeByte(0x00); // disposal=0, no transparency
        writeU16(delay);
        writeByte(0x00); // transparent color index
        writeByte(0x00); // block terminator

        // Image Descriptor
        writeByte(0x2C);
        writeU16(0); // left
        writeU16(0); // top
        writeU16(w);
        writeU16(h);
        writeByte(0x00); // no LCT

        // LZW Compress
        var minCodeSize = 8; // 256 colors = 8 bits
        writeByte(minCodeSize);
        var compressed = this.lzwEncode(minCodeSize, frame.indices);

        // Write sub-blocks
        var offset = 0;
        while (offset < compressed.length) {
          var chunkSize = Math.min(255, compressed.length - offset);
          writeByte(chunkSize);
          for (var s = 0; s < chunkSize; s++) {
            writeByte(compressed[offset + s]);
          }
          offset += chunkSize;
        }
        writeByte(0x00); // block terminator
      }

      // Trailer
      writeByte(0x3B);

      return buf.subarray(0, pos);
    },

    lzwEncode: function(minCodeSize, indices) {
      var clearCode = 1 << minCodeSize;
      var eoiCode = clearCode + 1;
      var codeSize = minCodeSize + 1;
      var nextCode = eoiCode + 1;
      var maxCode = (1 << codeSize);

      // Use Map for faster lookups
      var table = new Map();
      for (var i = 0; i < clearCode; i++) {
        table.set(String.fromCharCode(i), i);
      }

      // Pre-allocate output buffer
      var outputSize = Math.max(256, indices.length);
      var output = new Uint8Array(outputSize);
      var outputPos = 0;
      var bitBuffer = 0;
      var bitPos = 0;

      function writeCode(code) {
        bitBuffer |= (code << bitPos);
        bitPos += codeSize;
        while (bitPos >= 8) {
          if (outputPos >= output.length) {
            // Grow buffer
            var newOutput = new Uint8Array(output.length * 2);
            newOutput.set(output);
            output = newOutput;
          }
          output[outputPos++] = bitBuffer & 0xFF;
          bitBuffer >>= 8;
          bitPos -= 8;
        }
      }

      writeCode(clearCode);

      if (indices.length === 0) {
        writeCode(eoiCode);
        if (bitPos > 0) {
          if (outputPos >= output.length) {
            var grow = new Uint8Array(output.length + 1);
            grow.set(output);
            output = grow;
          }
          output[outputPos++] = bitBuffer & 0xFF;
        }
        return output.subarray(0, outputPos);
      }

      var current = String.fromCharCode(indices[0]);

      for (var j = 1; j < indices.length; j++) {
        var k = String.fromCharCode(indices[j]);
        var combined = current + k;

        if (table.has(combined)) {
          current = combined;
        } else {
          writeCode(table.get(current));

          if (nextCode < 4096) {
            table.set(combined, nextCode++);
            if (nextCode > maxCode && codeSize < 12) {
              codeSize++;
              maxCode = 1 << codeSize;
            }
          } else {
            writeCode(clearCode);
            table = new Map();
            for (var m = 0; m < clearCode; m++) {
              table.set(String.fromCharCode(m), m);
            }
            nextCode = eoiCode + 1;
            codeSize = minCodeSize + 1;
            maxCode = 1 << codeSize;
          }

          current = k;
        }
      }

      writeCode(table.get(current));
      writeCode(eoiCode);

      if (bitPos > 0) {
        if (outputPos >= output.length) {
          var finalGrow = new Uint8Array(output.length + 1);
          finalGrow.set(output);
          output = finalGrow;
        }
        output[outputPos++] = bitBuffer & 0xFF;
      }

      return output.subarray(0, outputPos);
    },
  };

  window.GIF = GIF;
})();
