/* gif.js - GIF Encoder Library
 * Based on gif.js by Johan Nordberg (MIT License)
 * https://github.com/jnordberg/gif.js
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
  }

  GIF.prototype = {
    addFrame: function(image, options) {
      var frame = Object.assign({
        delay: 100,
        copy: false,
        dispose: -1,
      }, options);

      if (frame.copy) {
        // Create an offscreen canvas and copy the image data
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
      // Process frames in main thread for simplicity
      // (no workers for file:// protocol compatibility)
      this.processFrames().then(function(frameData) {
        var buffer = self.encodeGIF(frameData);
        var blob = new Blob([buffer], { type: 'image/gif' });
        self.running = false;
        self.emit('finished', blob);
      }).catch(function(err) {
        console.error('GIF render error:', err);
        self.running = false;
      });
    },

    processFrames: function() {
      var self = this;
      var promises = this.frames.map(function(frame, index) {
        return new Promise(function(resolve) {
          var pixels = frame.data.data;
          var quantized = self.quantize(pixels);
          self.emit('progress', (index + 1) / self.frames.length);
          resolve({
            indices: quantized,
            delay: frame.delay,
            palette: self.currentPalette,
          });
        });
      });
      return Promise.all(promises);
    },

    // Color quantization using median cut (simplified)
    quantize: function(pixels) {
      var colors = [];
      var len = pixels.length;
      
      // Sample pixels and build color map
      for (var i = 0; i < len; i += 4) {
        colors.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
      }

      // Build palette (256 colors max, but use fewer for smaller GIF)
      var palette = this.medianCut(colors, 256);
      this.currentPalette = palette;

      // Map pixels to palette indices
      var indices = new Uint8Array(len / 4);
      for (var j = 0; j < colors.length; j++) {
        indices[j] = this.findClosestColor(colors[j], palette);
      }
      
      return indices;
    },

    medianCut: function(colors, maxColors) {
      // Simple median cut quantization
      var buckets = [colors];
      
      while (buckets.length < maxColors) {
        // Find the bucket with the largest range
        var maxRange = -1;
        var maxIdx = 0;
        var splitChannel = 0;

        for (var b = 0; b < buckets.length; b++) {
          var bucket = buckets[b];
          if (bucket.length < 2) continue;
          
          for (var ch = 0; ch < 3; ch++) {
            var min = 255, max = 0;
            for (var c = 0; c < bucket.length; c++) {
              if (bucket[c][ch] < min) min = bucket[c][ch];
              if (bucket[c][ch] > max) max = bucket[c][ch];
            }
            var range = max - min;
            if (range > maxRange) {
              maxRange = range;
              maxIdx = b;
              splitChannel = ch;
            }
          }
        }

        if (maxRange <= 0) break;

        // Sort and split the bucket
        var bucket = buckets[maxIdx];
        bucket.sort(function(a, b) { return a[splitChannel] - b[splitChannel]; });
        var mid = Math.floor(bucket.length / 2);
        buckets.splice(maxIdx, 1, bucket.slice(0, mid), bucket.slice(mid));
      }

      // Average each bucket to get palette colors
      var palette = [];
      for (var i = 0; i < buckets.length; i++) {
        var bucket = buckets[i];
        var r = 0, g = 0, b = 0;
        for (var j = 0; j < bucket.length; j++) {
          r += bucket[j][0];
          g += bucket[j][1];
          b += bucket[j][2];
        }
        var n = bucket.length;
        palette.push([~~(r / n), ~~(g / n), ~~(b / n)]);
      }

      // Pad to power of 2 size
      var pow2 = 2;
      while (pow2 < palette.length) pow2 *= 2;
      while (palette.length < pow2) {
        palette.push([0, 0, 0]);
      }

      return palette;
    },

    findClosestColor: function(color, palette) {
      var minDist = Infinity;
      var minIdx = 0;
      for (var i = 0; i < palette.length; i++) {
        var dr = color[0] - palette[i][0];
        var dg = color[1] - palette[i][1];
        var db = color[2] - palette[i][2];
        var dist = dr * dr + dg * dg + db * db;
        if (dist < minDist) {
          minDist = dist;
          minIdx = i;
        }
      }
      return minIdx;
    },

    encodeGIF: function(frameDataArray) {
      var buffers = [];
      var paletteSize = frameDataArray[0].palette.length;
      var colorRes = 8;
      var globalPalette = frameDataArray[0].palette;

      // Header
      buffers.push(this.strToBytes('GIF89a'));

      // Logical Screen Descriptor
      buffers.push(this.u16(this.width));
      buffers.push(this.u16(this.height));

      // GCT flag = 1, color resolution, sort flag, GCT size
      var gctSize = this.log2(globalPalette.length) - 1;
      buffers.push(0x80 | ((colorRes - 1) << 4) | gctSize);
      buffers.push(0x00); // bg color index
      buffers.push(0x00); // pixel aspect ratio

      // Global Color Table
      for (var p = 0; p < globalPalette.length; p++) {
        buffers.push(globalPalette[p][0]);
        buffers.push(globalPalette[p][1]);
        buffers.push(globalPalette[p][2]);
      }

      // Netscape Extension for looping
      buffers.push(0x21); // extension introducer
      buffers.push(0xFF); // app extension label
      buffers.push(0x0B); // block size
      buffers.push(this.strToBytes('NETSCAPE2.0'));
      buffers.push(0x03); // sub-block size
      buffers.push(0x01); // sub-block ID
      buffers.push(this.options.repeat & 0xFF); // loop count low byte
      buffers.push((this.options.repeat >> 8) & 0xFF); // loop count high byte
      buffers.push(0x00); // block terminator

      // Frames
      for (var f = 0; f < frameDataArray.length; f++) {
        var frame = frameDataArray[f];
        var delay = Math.round(frame.delay / 10); // in 1/100th sec

        // GCE
        buffers.push(0x21);
        buffers.push(0xF9);
        buffers.push(0x04);
        buffers.push(0x00); // disposal, transparency
        buffers.push(this.u16(delay));
        buffers.push(0x00); // transparent color index
        buffers.push(0x00);

        // Image Descriptor
        buffers.push(0x2C);
        buffers.push(this.u16(0)); // left
        buffers.push(this.u16(0)); // top
        buffers.push(this.u16(this.width));
        buffers.push(this.u16(this.height));
        buffers.push(0x00); // no LCT

        // LZW Image Data
        var lzwMinCodeSize = Math.max(2, this.log2(globalPalette.length));
        buffers.push(lzwMinCodeSize);
        
        var compressed = this.lzwEncode(lzwMinCodeSize, frame.indices);
        // Write sub-blocks
        var offset = 0;
        while (offset < compressed.length) {
          var chunkSize = Math.min(255, compressed.length - offset);
          buffers.push(chunkSize);
          for (var s = 0; s < chunkSize; s++) {
            buffers.push(compressed[offset + s]);
          }
          offset += chunkSize;
        }
        buffers.push(0x00); // block terminator
      }

      // Trailer
      buffers.push(0x3B);

      // Combine all buffers
      var totalLen = 0;
      for (var i = 0; i < buffers.length; i++) {
        if (typeof buffers[i] === 'number') {
          totalLen += 1;
        } else {
          totalLen += buffers[i].length;
        }
      }

      var result = new Uint8Array(totalLen);
      var pos = 0;
      for (var j = 0; j < buffers.length; j++) {
        if (typeof buffers[j] === 'number') {
          result[pos++] = buffers[j];
        } else {
          result.set(buffers[j], pos);
          pos += buffers[j].length;
        }
      }

      return result;
    },

    lzwEncode: function(minCodeSize, indices) {
      var clearCode = 1 << minCodeSize;
      var eoiCode = clearCode + 1;
      var codeSize = minCodeSize + 1;
      var nextCode = eoiCode + 1;
      var maxCode = (1 << codeSize);

      var table = {};
      var output = [];

      // Initialize code table
      for (var i = 0; i < clearCode; i++) {
        table[String.fromCharCode(i)] = i;
      }

      var bitBuffer = 0;
      var bitPos = 0;

      function writeCode(code) {
        bitBuffer |= (code << bitPos);
        bitPos += codeSize;
        while (bitPos >= 8) {
          output.push(bitBuffer & 0xFF);
          bitBuffer >>= 8;
          bitPos -= 8;
        }
      }

      writeCode(clearCode);

      if (indices.length === 0) {
        writeCode(eoiCode);
        if (bitPos > 0) output.push(bitBuffer & 0xFF);
        return new Uint8Array(output);
      }

      var current = String.fromCharCode(indices[0]);

      for (var j = 1; j < indices.length; j++) {
        var k = String.fromCharCode(indices[j]);
        var combined = current + k;

        if (table.hasOwnProperty(combined)) {
          current = combined;
        } else {
          writeCode(table[current]);
          
          if (nextCode < 4096) {
            table[combined] = nextCode++;
            if (nextCode > maxCode && codeSize < 12) {
              codeSize++;
              maxCode = 1 << codeSize;
            }
          } else {
            writeCode(clearCode);
            table = {};
            for (var m = 0; m < clearCode; m++) {
              table[String.fromCharCode(m)] = m;
            }
            nextCode = eoiCode + 1;
            codeSize = minCodeSize + 1;
            maxCode = 1 << codeSize;
          }

          current = k;
        }
      }

      writeCode(table[current]);
      writeCode(eoiCode);

      if (bitPos > 0) output.push(bitBuffer & 0xFF);

      return new Uint8Array(output);
    },

    strToBytes: function(str) {
      var bytes = new Uint8Array(str.length);
      for (var i = 0; i < str.length; i++) {
        bytes[i] = str.charCodeAt(i);
      }
      return bytes;
    },

    u16: function(val) {
      return new Uint8Array([val & 0xFF, (val >> 8) & 0xFF]); // little-endian
    },

    log2: function(n) {
      var r = 0;
      while (n > 1) { n >>= 1; r++; }
      return r;
    },
  };

  window.GIF = GIF;
})();
