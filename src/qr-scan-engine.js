(function () {
  function decodeQrFromCanvas(canvasEl) {
    if (!canvasEl || !window.jsQR) {
      return "";
    }

    const ctx = canvasEl.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      return "";
    }

    const imageData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
    const detected = window.jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "attemptBoth"
    });
    return detected?.data || "";
  }

  function createScanner(config) {
    const cfg = config || {};
    let stream = null;
    let timer = null;
    let mode = cfg.defaultMode === "camera" ? "camera" : "file";

    const modeTabsRoot = cfg.modeTabsSelector ? document.querySelector(cfg.modeTabsSelector) : null;
    const videoEl = cfg.videoId ? document.getElementById(cfg.videoId) : null;
    const canvasEl = cfg.canvasId ? document.getElementById(cfg.canvasId) : null;
    const startBtn = cfg.startBtnId ? document.getElementById(cfg.startBtnId) : null;
    const stopBtn = cfg.stopBtnId ? document.getElementById(cfg.stopBtnId) : null;
    const fileInput = cfg.fileInputId ? document.getElementById(cfg.fileInputId) : null;

    function setStatus(message, isError) {
      if (typeof cfg.setStatus === "function") {
        cfg.setStatus(message, !!isError);
      }
    }

    function applyModeUi() {
      if (modeTabsRoot && cfg.modeAttr) {
        for (const btn of modeTabsRoot.querySelectorAll(`[${cfg.modeAttr}]`)) {
          const btnMode = btn.getAttribute(cfg.modeAttr);
          btn.classList.toggle("active", btnMode === mode);
        }
      }

      if (cfg.paneAttr) {
        for (const pane of document.querySelectorAll(`[${cfg.paneAttr}]`)) {
          const paneMode = pane.getAttribute(cfg.paneAttr);
          pane.style.display = paneMode === mode ? "block" : "none";
        }
      }
    }

    function stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }

      if (stream) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        stream = null;
      }

      if (videoEl) {
        videoEl.srcObject = null;
      }

      setStatus("Skanner inaktiv.");
    }

    function setMode(nextMode) {
      mode = nextMode === "camera" ? "camera" : "file";
      applyModeUi();

      if (mode !== "camera") {
        stop();
      }
    }

    async function startCameraScan() {
      if (!videoEl || !canvasEl) {
        return;
      }

      stop();

      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("Webkamera stodds inte i denna webblasare.", true);
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment"
          },
          audio: false
        });
        videoEl.srcObject = stream;
        await videoEl.play();
        setStatus("Webkamera aktiv. Haller pa att skanna...");

        timer = setInterval(() => {
          if (!videoEl.videoWidth || !videoEl.videoHeight) {
            return;
          }

          canvasEl.width = videoEl.videoWidth;
          canvasEl.height = videoEl.videoHeight;
          const ctx = canvasEl.getContext("2d", { willReadFrequently: true });
          if (!ctx) {
            return;
          }

          ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
          const data = decodeQrFromCanvas(canvasEl);
          if (data && typeof cfg.onDecoded === "function") {
            cfg.onDecoded(data, "camera");
          }
        }, 220);
      } catch (_err) {
        setStatus("Kunde inte starta webkamera. Kontrollera tillstand.", true);
      }
    }

    function decodeUploadedFile(file) {
      if (!canvasEl || !file) {
        return;
      }

      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        try {
          canvasEl.width = img.naturalWidth || img.width;
          canvasEl.height = img.naturalHeight || img.height;
          const ctx = canvasEl.getContext("2d", { willReadFrequently: true });
          if (!ctx) {
            setStatus("Kunde inte lasa bild for QR-skanning.", true);
            return;
          }
          ctx.drawImage(img, 0, 0, canvasEl.width, canvasEl.height);
          const data = decodeQrFromCanvas(canvasEl);
          if (data && typeof cfg.onDecoded === "function") {
            cfg.onDecoded(data, "file");
          } else {
            setStatus("Ingen QR-kod hittades i vald bild.", true);
          }
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        setStatus("Kunde inte lasa vald bild.", true);
      };
      img.src = objectUrl;
    }

    if (modeTabsRoot && cfg.modeAttr) {
      modeTabsRoot.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return;
        }
        const nextMode = target.getAttribute(cfg.modeAttr);
        if (!nextMode) {
          return;
        }
        setMode(nextMode);
      });
    }

    if (startBtn) {
      startBtn.addEventListener("click", () => {
        setMode("camera");
        startCameraScan();
      });
    }

    if (stopBtn) {
      stopBtn.addEventListener("click", () => {
        stop();
      });
    }

    if (fileInput) {
      fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (!file) {
          return;
        }
        setMode("file");
        decodeUploadedFile(file);
        fileInput.value = "";
      });
    }

    applyModeUi();

    return {
      stop,
      setMode,
      startCameraScan,
      decodeUploadedFile
    };
  }

  window.QrScanEngine = {
    createScanner,
    decodeQrFromCanvas
  };
})();
