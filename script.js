(function () {
  "use strict";

  const fileInput = document.getElementById("fileInput");
  const uploadBox = document.getElementById("uploadBox");
  const uploadSection = document.getElementById("uploadSection");
  const controlBar = document.getElementById("controlBar");
  const resultSection = document.getElementById("resultSection");
  const previewImage = document.getElementById("previewImage");
  const paletteList = document.getElementById("paletteList");
  const colorCountSelect = document.getElementById("colorCount");
  const ignoreWhiteCheckbox = document.getElementById("ignoreWhite");
  const ignoreBlackCheckbox = document.getElementById("ignoreBlack");
  const ignoreGrayCheckbox = document.getElementById("ignoreGray");
  const reuploadBtn = document.getElementById("reuploadBtn");
  const copyAllBtn = document.getElementById("copyAllBtn");
  const toast = document.getElementById("toast");

  let currentImageData = null;
  let currentColors = [];

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove("show"), 1800);
  }

  function rgbToHex(r, g, b) {
    return (
      "#" +
      [r, g, b]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase()
    );
  }

  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        case b:
          h = (r - g) / d + 4;
          break;
      }
      h *= 60;
    }

    return {
      h: Math.round(h),
      s: Math.round(s * 100),
      l: Math.round(l * 100),
    };
  }

  function getImagePixels(img) {
    const maxSize = 200;
    const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);

    const imageData = ctx.getImageData(0, 0, w, h);
    return imageData.data;
  }

  function isNearGray(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const avg = (r + g + b) / 3;
    return max - min <= 18 && avg >= 20 && avg <= 235;
  }

  function quantize(pixels, colorCount, options) {
    const ignoreWhite = options.ignoreWhite;
    const ignoreBlack = options.ignoreBlack;
    const ignoreGray = options.ignoreGray;

    const points = [];
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];
      if (a < 125) continue;

      if (ignoreWhite && r > 240 && g > 240 && b > 240) continue;
      if (ignoreBlack && r < 15 && g < 15 && b < 15) continue;
      if (ignoreGray && isNearGray(r, g, b)) continue;

      points.push([r, g, b]);
    }

    if (points.length === 0) {
      return [];
    }

    function getRange(bucket) {
      let rMin = 255, rMax = 0;
      let gMin = 255, gMax = 0;
      let bMin = 255, bMax = 0;
      for (let i = 0; i < bucket.length; i++) {
        const p = bucket[i];
        if (p[0] < rMin) rMin = p[0];
        if (p[0] > rMax) rMax = p[0];
        if (p[1] < gMin) gMin = p[1];
        if (p[1] > gMax) gMax = p[1];
        if (p[2] < bMin) bMin = p[2];
        if (p[2] > bMax) bMax = p[2];
      }
      return {
        r: rMax - rMin,
        g: gMax - gMin,
        b: bMax - bMin,
      };
    }

    let buckets = [points];

    while (buckets.length < colorCount) {
      let maxRange = -1;
      let maxBucketIndex = -1;
      let maxChannel = "r";

      for (let i = 0; i < buckets.length; i++) {
        const bucket = buckets[i];
        if (bucket.length < 2) continue;
        const range = getRange(bucket);
        const channelRange = Math.max(range.r, range.g, range.b);
        if (channelRange > maxRange) {
          maxRange = channelRange;
          maxBucketIndex = i;
          maxChannel =
            range.r >= range.g && range.r >= range.b
              ? "r"
              : range.g >= range.b
                ? "g"
                : "b";
        }
      }

      if (maxBucketIndex === -1) break;

      const bucket = buckets[maxBucketIndex];
      const channelIndex = maxChannel === "r" ? 0 : maxChannel === "g" ? 1 : 2;
      bucket.sort((a, b) => a[channelIndex] - b[channelIndex]);
      const mid = Math.floor(bucket.length / 2);
      const left = bucket.slice(0, mid);
      const right = bucket.slice(mid);

      buckets.splice(maxBucketIndex, 1, left, right);
    }

    const colors = buckets.map((bucket) => {
      let r = 0,
        g = 0,
        b = 0;
      for (let i = 0; i < bucket.length; i++) {
        r += bucket[i][0];
        g += bucket[i][1];
        b += bucket[i][2];
      }
      const n = bucket.length;
      return {
        r: Math.round(r / n),
        g: Math.round(g / n),
        b: Math.round(b / n),
        count: n,
      };
    });

    colors.forEach((c) => {
      const hsl = rgbToHsl(c.r, c.g, c.b);
      c.h = hsl.h;
      c.s = hsl.s;
      c.l = hsl.l;
    });

    colors.sort((a, b) => {
      const aNeutral = a.s < 15;
      const bNeutral = b.s < 15;
      if (aNeutral && bNeutral) return a.l - b.l;
      if (aNeutral) return -1;
      if (bNeutral) return 1;
      return a.h - b.h;
    });

    return colors;
  }

  function copyToClipboard(text, toastMessage) {
    const message = toastMessage || "已复制：" + text;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => showToast(message),
        () => fallbackCopy(text, message)
      );
    } else {
      fallbackCopy(text, message);
    }
  }

  function fallbackCopy(text, toastMessage) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      showToast(toastMessage || "已复制：" + text);
    } catch (e) {
      showToast("复制失败");
    }
    document.body.removeChild(textarea);
  }

  function paletteCopyText(colors) {
    return colors
      .map((c) => {
        const hex = rgbToHex(c.r, c.g, c.b);
        return `${hex}  rgb(${c.r}, ${c.g}, ${c.b})`;
      })
      .join("\n");
  }

  function renderPalette(colors) {
    paletteList.innerHTML = "";
    colors.forEach((color) => {
      const item = document.createElement("div");
      item.className = "color-item";

      const swatch = document.createElement("div");
      swatch.className = "color-swatch";
      swatch.style.backgroundColor = rgbToHex(color.r, color.g, color.b);
      swatch.title = "点击复制 HEX";
      swatch.addEventListener("click", () =>
        copyToClipboard(rgbToHex(color.r, color.g, color.b))
      );

      const info = document.createElement("div");
      info.className = "color-info";

      const hex = rgbToHex(color.r, color.g, color.b);
      const rgbStr = `rgb(${color.r}, ${color.g}, ${color.b})`;

      info.innerHTML = `
        <div>
          <span class="label">HEX</span>
          <span class="value" data-copy="${hex}">${hex}</span>
        </div>
        <div>
          <span class="label">RGB</span>
          <span class="value" data-copy="${rgbStr}">${rgbStr}</span>
        </div>
      `;

      info.querySelectorAll(".value").forEach((el) => {
        el.addEventListener("click", () => copyToClipboard(el.dataset.copy));
      });

      item.appendChild(swatch);
      item.appendChild(info);
      paletteList.appendChild(item);
    });
  }

  function extractPalette() {
    if (!currentImageData) return;
    const colorCount = parseInt(colorCountSelect.value, 10);
    const colors = quantize(currentImageData, colorCount, {
      ignoreWhite: ignoreWhiteCheckbox.checked,
      ignoreBlack: ignoreBlackCheckbox.checked,
      ignoreGray: ignoreGrayCheckbox.checked,
    });

    if (colors.length === 0) {
      currentColors = [];
      copyAllBtn.disabled = true;
      paletteList.innerHTML =
        '<p style="color:var(--text-muted);text-align:center;padding:24px;">未能提取到颜色，请尝试调整过滤选项</p>';
      return;
    }

    currentColors = colors;
    copyAllBtn.disabled = false;
    renderPalette(colors);
  }

  function loadImageFromSrc(src) {
    const img = new Image();
    img.onload = () => {
      currentImageData = getImagePixels(img);
      previewImage.src = src;
      uploadSection.hidden = true;
      controlBar.hidden = false;
      resultSection.hidden = false;
      extractPalette();
    };
    img.onerror = () => showToast("图片加载失败");
    img.src = src;
  }

  function handleImage(file) {
    if (!file.type.startsWith("image/")) {
      showToast("请上传图片文件");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => loadImageFromSrc(e.target.result);
    reader.onerror = () => showToast("文件读取失败");
    reader.readAsDataURL(file);
  }

  document.addEventListener("paste", (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        const blob = item.getAsFile();
        if (blob) {
          e.preventDefault();
          const url = URL.createObjectURL(blob);
          loadImageFromSrc(url);
          showToast("已从剪贴板读取图片");
          return;
        }
      }
    }
  });

  uploadBox.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) {
      handleImage(e.target.files[0]);
    }
  });

  ["dragenter", "dragover"].forEach((evt) => {
    uploadBox.addEventListener(evt, (e) => {
      e.preventDefault();
      uploadBox.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((evt) => {
    uploadBox.addEventListener(evt, (e) => {
      e.preventDefault();
      uploadBox.classList.remove("dragover");
    });
  });

  uploadBox.addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleImage(e.dataTransfer.files[0]);
    }
  });

  colorCountSelect.addEventListener("change", extractPalette);
  ignoreWhiteCheckbox.addEventListener("change", extractPalette);
  ignoreBlackCheckbox.addEventListener("change", extractPalette);
  ignoreGrayCheckbox.addEventListener("change", extractPalette);

  copyAllBtn.addEventListener("click", () => {
    if (!currentColors.length) return;
    copyToClipboard(paletteCopyText(currentColors), "已复制全部配色方案");
  });

  reuploadBtn.addEventListener("click", () => {
    fileInput.value = "";
    currentImageData = null;
    currentColors = [];
    copyAllBtn.disabled = true;
    uploadSection.hidden = false;
    controlBar.hidden = true;
    resultSection.hidden = true;
    paletteList.innerHTML = "";
    previewImage.src = "";
  });
})();
