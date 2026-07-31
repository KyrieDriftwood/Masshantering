(function () {
  const PROV_COLUMNS = [
    "Provtillfalle", "Datum", "SWEREF_N", "SWEREF_E", "As", "Ba", "Cd", "Co", "Cr", "Cu", "Hg", "Mo", "Ni", "Pb", "Sb", "Se", "V", "Zn",
    "Micro_Deleval", "Los_Angeles", "Bergklass", "Totalsvavel", "NagPh"
  ];

  const ELEMENT_NAME_BY_SYMBOL = {
    As: "Arsenik",
    Ba: "Barium",
    Cd: "Kadmium",
    Co: "Kobolt",
    Cr: "Krom",
    Cu: "Koppar",
    Hg: "Kvicksilver",
    Mo: "Molybden",
    Ni: "Nickel",
    Pb: "Bly",
    Sb: "Antimon",
    Se: "Selen",
    V: "Vanadin",
    Zn: "Zink"
  };

  const PROV_DEFAULTS = {
    As: "0.000", Ba: "0.000", Cd: "0.000", Co: "0.000", Cr: "0.000", Cu: "0.000", Hg: "0.000", Mo: "0.000", Ni: "0.000", Pb: "0.000",
    Sb: "0.000", Se: "0.000", V: "0.000", Zn: "0.000", Micro_Deleval: "0.000", Los_Angeles: "0.000", Bergklass: "0.000", Totalsvavel: "0.000", NagPh: "0.000"
  };

  function escapeCsvValue(value) {
    const text = String(value ?? "");
    if (text.includes(";") || text.includes("\n") || text.includes('"')) {
      return `"${text.replace(/\"/g, '""')}"`;
    }
    return text;
  }

  function getProvCsvHeaderLabel(key) {
    if (ELEMENT_NAME_BY_SYMBOL[key]) {
      return ELEMENT_NAME_BY_SYMBOL[key];
    }
    if (key === "SWEREF_N") {
      return "SWEREF N";
    }
    if (key === "SWEREF_E") {
      return "SWEREF E";
    }
    return key.replace(/_/g, " ");
  }

  function toIsoDate(value) {
    const text = String(value ?? "").trim();
    if (!text) {
      return "";
    }
    const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) {
      return "";
    }
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (
      dt.getUTCFullYear() !== y
      || dt.getUTCMonth() !== mo - 1
      || dt.getUTCDate() !== d
    ) {
      return "";
    }
    return `${m[1]}-${m[2]}-${m[3]}`;
  }

  function isoDateToUnixDays(isoDate) {
    const normalized = toIsoDate(isoDate);
    if (!normalized) {
      return "";
    }
    const parts = normalized.split("-").map((part) => Number(part));
    const yy = parts[0];
    const mm = parts[1];
    const dd = parts[2];
    const ms = Date.UTC(yy, mm - 1, dd);
    return String(Math.floor(ms / 86400000));
  }

  function buildProvCsvFromRows(rows, options) {
    const cfg = options || {};
    const compactDateForQr = !!cfg.compactDateForQr;
    const header = PROV_COLUMNS.map((key) => getProvCsvHeaderLabel(key)).join(";");
    const body = rows.map((row) => {
      return PROV_COLUMNS.map((key) => {
        if (key === "Datum" && compactDateForQr) {
          return escapeCsvValue(isoDateToUnixDays(row[key]));
        }
        return escapeCsvValue(row[key] ?? "");
      }).join(";");
    });
    return [header].concat(body).join("\n");
  }

  function createProvTemplate(overrides) {
    const src = overrides || {};
    const row = {};
    for (const col of PROV_COLUMNS) {
      row[col] = src[col] ?? (PROV_DEFAULTS[col] ?? "");
    }
    return row;
  }

  function getProvFieldLabel(key) {
    if (ELEMENT_NAME_BY_SYMBOL[key]) {
      return ELEMENT_NAME_BY_SYMBOL[key];
    }
    if (key === "SWEREF_N") {
      return "SWEREF N";
    }
    if (key === "SWEREF_E") {
      return "SWEREF E";
    }
    if (key === "Datum") {
      return "Datum (XXXX-XX-XX)";
    }
    if (key === "Provtillfalle") {
      return "Provtillfalle";
    }
    return key.replace(/_/g, " ");
  }

  function parseDelimitedCsv(text, delimiter) {
    const sep = delimiter || ";";
    const src = String(text ?? "");
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;

    for (let i = 0; i < src.length; i += 1) {
      const ch = src[i];

      if (inQuotes) {
        if (ch === '"') {
          if (src[i + 1] === '"') {
            cell += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          cell += ch;
        }
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
        continue;
      }

      if (ch === sep) {
        row.push(cell);
        cell = "";
        continue;
      }

      if (ch === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
        continue;
      }

      if (ch === "\r") {
        continue;
      }

      cell += ch;
    }

    if (cell !== "" || row.length > 0) {
      row.push(cell);
      rows.push(row);
    }

    return rows.filter((r) => r.some((value) => String(value).trim() !== ""));
  }

  function unixDaysToIsoDate(dayValue) {
    const text = String(dayValue ?? "").trim();
    if (!/^-?\d+$/.test(text)) {
      return "";
    }
    const dayCount = Number.parseInt(text, 10);
    if (!Number.isFinite(dayCount)) {
      return "";
    }
    const ms = dayCount * 86400000;
    const dt = new Date(ms);
    if (!Number.isFinite(dt.getTime())) {
      return "";
    }
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const d = String(dt.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function getProvKeyFromQrHeader(header) {
    const normalized = String(header ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    for (const key of PROV_COLUMNS) {
      const label = getProvCsvHeaderLabel(key).toLowerCase();
      if (normalized === label || normalized === key.toLowerCase() || normalized === key.toLowerCase().replace(/_/g, " ")) {
        return key;
      }
    }
    return "";
  }

  function normalizeQrValueByField(field, rawValue) {
    const value = String(rawValue ?? "").trim();
    if (!value) {
      return "";
    }

    if (field === "Datum") {
      const dateFromDays = unixDaysToIsoDate(value);
      if (dateFromDays) {
        return dateFromDays;
      }
      const normalized = toIsoDate(value);
      return normalized || value;
    }

    return value;
  }

  function buildProvRowsFromPayload(payload) {
    const rows = parseDelimitedCsv(payload, ";");
    if (rows.length < 2) {
      return [];
    }

    const headers = rows[0].map((h) => String(h ?? ""));
    const mappedKeys = headers.map((header) => getProvKeyFromQrHeader(header));
    if (!mappedKeys.some((key) => !!key)) {
      return [];
    }

    const out = [];
    for (let i = 1; i < rows.length; i += 1) {
      const srcRow = rows[i];
      const row = createProvTemplate({});
      let hasValue = false;

      for (let c = 0; c < mappedKeys.length; c += 1) {
        const key = mappedKeys[c];
        if (!key) {
          continue;
        }
        const normalized = normalizeQrValueByField(key, srcRow[c]);
        if (!normalized) {
          continue;
        }
        row[key] = normalized;
        hasValue = true;
      }

      if (hasValue) {
        out.push(row);
      }
    }

    return out;
  }

  function mergeProvRowSets(primaryRows, secondaryRows) {
    const maxLen = Math.max(primaryRows.length, secondaryRows.length);
    const merged = [];

    for (let i = 0; i < maxLen; i += 1) {
      const first = primaryRows[i] || createProvTemplate({});
      const second = secondaryRows[i] || createProvTemplate({});
      const row = createProvTemplate({});

      for (const col of PROV_COLUMNS) {
        const firstValue = String(first[col] ?? "").trim();
        const secondValue = String(second[col] ?? "").trim();
        row[col] = firstValue ? first[col] : secondValue;
      }

      if (PROV_COLUMNS.some((col) => String(row[col] ?? "").trim() !== "")) {
        merged.push(row);
      }
    }

    return merged;
  }

  window.ProvCore = {
    PROV_COLUMNS,
    ELEMENT_NAME_BY_SYMBOL,
    PROV_DEFAULTS,
    escapeCsvValue,
    getProvCsvHeaderLabel,
    toIsoDate,
    isoDateToUnixDays,
    buildProvCsvFromRows,
    createProvTemplate,
    getProvFieldLabel,
    parseDelimitedCsv,
    unixDaysToIsoDate,
    getProvKeyFromQrHeader,
    normalizeQrValueByField,
    buildProvRowsFromPayload,
    mergeProvRowSets
  };
})();
