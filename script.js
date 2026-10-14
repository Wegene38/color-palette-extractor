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

  function rgbToLab(r, g, b) {
    const lin = (v) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const rl = lin(r);
    const gl = lin(g);
    const bl = lin(b);

    const x = (0.4124 * rl + 0.3576 * gl + 0.1805 * bl) / 0.95047;
    const y = 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
    const z = (0.0193 * rl + 0.1192 * gl + 0.9505 * bl) / 1.08883;

    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const fx = f(x);
    const fy = f(y);
    const fz = f(z);

    return {
      L: 116 * fy - 16,
      a: 500 * (fx - fy),
      b: 200 * (fy - fz),
    };
  }

  function labDistance(p, q) {
    const dL = p.L - q.L;
    const da = p.a - q.a;
    const db = p.b - q.b;
    return Math.sqrt(dL * dL + da * da + db * db);
  }

  // 在 Lab 空间中求经过所有颜色的最短开放路径（Held-Karp 动态规划，颜色数 ≤ 12 时开销很小），
  // 使相邻颜色的感知差异之和最小。start 不为 -1 时固定从该点出发。返回下标顺序。
  function shortestPath(labs, start) {
    const n = labs.length;
    if (n <= 2) return labs.map((_, i) => i);

    const dist = labs.map((p) => labs.map((q) => labDistance(p, q)));
    const full = 1 << n;
    const dp = new Float64Array(full * n).fill(Infinity);
    const parent = new Int8Array(full * n).fill(-1);
    for (let j = 0; j < n; j++) {
      if (start === -1 || j === start) dp[(1 << j) * n + j] = 0;
    }

    for (let mask = 1; mask < full; mask++) {
      for (let j = 0; j < n; j++) {
        const cur = dp[mask * n + j];
        if (cur === Infinity) continue;
        for (let k = 0; k < n; k++) {
          if (mask & (1 << k)) continue;
          const next = (mask | (1 << k)) * n + k;
          const cost = cur + dist[j][k];
          if (cost < dp[next]) {
            dp[next] = cost;
            parent[next] = j;
          }
        }
      }
    }

    const last = full - 1;
    let end = 0;
    for (let j = 1; j < n; j++) {
      if (dp[last * n + j] < dp[last * n + end]) end = j;
    }

    const order = [];
    let mask = last;
    let j = end;
    while (j !== -1) {
      order.push(j);
      const p = parent[mask * n + j];
      mask &= ~(1 << j);
      j = p;
    }
    return order.reverse();
  }

  // 中性色（白 / 灰 / 黑）按明度由浅到深排在前面；彩色按 Lab 最短路径排列，
  // 并以最后一个中性色为起点求路径，使整条色板连续渐变。
  function sortByGradient(colors) {
    const items = colors.map((c) => {
      const lab = rgbToLab(c.r, c.g, c.b);
      return { color: c, lab, chroma: Math.hypot(lab.a, lab.b) };
    });

    const neutrals = items.filter((it) => it.chroma < 8).sort((p, q) => q.lab.L - p.lab.L);
    const chromatic = items.filter((it) => it.chroma >= 8);

    let order;
    if (neutrals.length) {
      const anchor = neutrals[neutrals.length - 1];
      const labs = [anchor.lab].concat(chromatic.map((it) => it.lab));
      order = shortestPath(labs, 0).slice(1).map((i) => chromatic[i - 1]);
    } else {
      order = shortestPath(chromatic.map((it) => it.lab), -1).map((i) => chromatic[i]);
      if (order.length > 1 && order[order.length - 1].lab.L > order[0].lab.L) order.reverse();
    }

    return neutrals.concat(order).map((it) => it.color);
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

    return sortByGradient(colors);
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
