(function () {
  function createMergeController(config) {
    const cfg = config || {};

    const fileInputA = document.getElementById(cfg.fileInputAId);
    const fileInputB = document.getElementById(cfg.fileInputBId);
    const rawA = document.getElementById(cfg.rawAId);
    const rawB = document.getElementById(cfg.rawBId);
    const rawOut = document.getElementById(cfg.rawOutId);
    const qrWrap = document.getElementById(cfg.qrWrapId);
    const statusA = document.getElementById(cfg.statusAId);
    const statusB = document.getElementById(cfg.statusBId);
    const statusOut = document.getElementById(cfg.statusOutId);
    const generateBtn = document.getElementById(cfg.generateBtnId);

    let payloadA = "";
    let payloadB = "";

    const decodeCanvas = document.createElement("canvas");

    function setStatus(el, message, isError) {
      if (!el) {
        return;
      }
      el.textContent = message;
      el.classList.toggle("error", !!isError);
    }

    function renderMergedQrPayload(csvText) {
      if (!qrWrap) {
        return;
      }

      qrWrap.innerHTML = "";
      if (!csvText.trim()) {
        qrWrap.innerHTML = '<div class="mono">Ingen sammanslagen QR skapad.</div>';
        return;
      }

      if (!window.QRCode) {
        qrWrap.innerHTML = '<div class="mono">QR-bibliotek saknas i lasaren.</div>';
        return;
      }

      try {
        new window.QRCode(qrWrap, {
          text: csvText,
          width: 210,
          height: 210,
          correctLevel: window.QRCode.CorrectLevel.M
        });
      } catch (_err) {
        qrWrap.innerHTML = '<div class="mono">Kunde inte skapa sammanslagen QR.</div>';
      }
    }

    function updateMergedPayloadView() {
      if (!rawOut) {
        return;
      }

      if (!payloadA.trim() || !payloadB.trim()) {
        rawOut.value = "";
        setStatus(statusOut, "Ladda in bada QR-koder for att skapa summa.", false);
        renderMergedQrPayload("");
        return;
      }

      const rowsA = window.ProvCore.buildProvRowsFromPayload(payloadA);
      const rowsB = window.ProvCore.buildProvRowsFromPayload(payloadB);

      if (!rowsA.length || !rowsB.length) {
        rawOut.value = "";
        setStatus(statusOut, "En av QR-koderna innehaller inte igenkannbar prov-CSV.", true);
        renderMergedQrPayload("");
        return;
      }

      const mergedRows = window.ProvCore.mergeProvRowSets(rowsA, rowsB);
      if (!mergedRows.length) {
        rawOut.value = "";
        setStatus(statusOut, "Ingen sammanfogad data kunde skapas.", true);
        renderMergedQrPayload("");
        return;
      }

      const mergedCsv = window.ProvCore.buildProvCsvFromRows(mergedRows, { compactDateForQr: true });
      rawOut.value = mergedCsv;
      setStatus(statusOut, `Summa skapad fran ${mergedRows.length} flikar.`, false);
      renderMergedQrPayload(mergedCsv);
    }

    function decodeMergeQrFromFile(slot, file) {
      if (!file) {
        return;
      }

      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        try {
          decodeCanvas.width = img.naturalWidth || img.width;
          decodeCanvas.height = img.naturalHeight || img.height;
          const ctx = decodeCanvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) {
            setStatus(slot === "a" ? statusA : statusB, "Kunde inte lasa bild for QR-skanning.", true);
            return;
          }

          ctx.drawImage(img, 0, 0, decodeCanvas.width, decodeCanvas.height);
          const data = window.QrScanEngine.decodeQrFromCanvas(decodeCanvas);
          if (!data) {
            setStatus(slot === "a" ? statusA : statusB, "Ingen QR-kod hittades i vald bild.", true);
            return;
          }

          if (slot === "a") {
            payloadA = String(data);
            if (rawA) {
              rawA.value = payloadA;
            }
            setStatus(statusA, "QR-kod inlast.", false);
          } else {
            payloadB = String(data);
            if (rawB) {
              rawB.value = payloadB;
            }
            setStatus(statusB, "QR-kod inlast.", false);
          }

          updateMergedPayloadView();
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        setStatus(slot === "a" ? statusA : statusB, "Kunde inte lasa vald bild.", true);
      };

      img.src = objectUrl;
    }

    if (fileInputA) {
      fileInputA.addEventListener("change", () => {
        const file = fileInputA.files?.[0];
        if (!file) {
          return;
        }
        decodeMergeQrFromFile("a", file);
        fileInputA.value = "";
      });
    }

    if (fileInputB) {
      fileInputB.addEventListener("change", () => {
        const file = fileInputB.files?.[0];
        if (!file) {
          return;
        }
        decodeMergeQrFromFile("b", file);
        fileInputB.value = "";
      });
    }

    if (generateBtn) {
      generateBtn.addEventListener("click", () => {
        updateMergedPayloadView();
      });
    }

    return {
      updateMergedPayloadView
    };
  }

  window.QrMerge = {
    createMergeController
  };
})();
