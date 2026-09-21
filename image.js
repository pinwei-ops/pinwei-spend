// Prepares an attachment for upload: fingerprint of the ORIGINAL file (so the
// same photo sent twice is caught even after compression), then shrink photos
// in the browser — phone photos are 5–10 MB, which is slow and can exceed the
// request limit.

window.Attachment = (function () {
  const MAX_EDGE = 1600;
  const JPEG_QUALITY = 0.7;

  async function sha256Hex(blob) {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function toBase64(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result).split(',')[1]); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  async function loadBitmap(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (err) { /* fall back */ }
    }
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('This photo could not be read. Try another one.')); };
      img.src = URL.createObjectURL(file);
    });
  }

  async function compressImage(file) {
    const bitmap = await loadBitmap(file);
    const w = bitmap.width;
    const h = bitmap.height;
    const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY); });
    if (!blob) throw new Error('This photo could not be compressed. Try another one.');
    return blob;
  }

  /**
   * @return {Promise<{name, mime, base64, sha256, sizeBefore, sizeAfter}>}
   */
  async function prepare(file, maxMb) {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf && !/^image\//.test(file.type)) throw new Error('Please choose a photo or a PDF file.');
    const sha256 = await sha256Hex(file);
    const out = isPdf ? file : await compressImage(file);
    if (out.size > maxMb * 1024 * 1024) throw new Error('The file is larger than ' + maxMb + ' MB after compression.');
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'upload';
    return {
      name: isPdf ? file.name : baseName + '.jpg',
      mime: isPdf ? 'application/pdf' : 'image/jpeg',
      base64: await toBase64(out),
      sha256: sha256,
      sizeBefore: file.size,
      sizeAfter: out.size,
    };
  }

  return { prepare: prepare };
})();
