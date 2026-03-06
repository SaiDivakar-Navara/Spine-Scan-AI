// SpineAI JavaScript

// ── Global store — populated after every successful /detect call ──
window.spineReport   = null;   // data.report  (JSON)
window.originalImage = null;   // base64 data-URI of user-uploaded image
window.detectedImage = null;   // base64 data-URI of annotated image from backend

document.addEventListener('DOMContentLoaded', () => {
    const currentPage = sessionStorage.getItem("currentPage") || "home";
    showPage(currentPage);

    const savedDark = localStorage.getItem('darkMode') === 'true';
    applyDarkMode(savedDark);

    const dropzone  = document.getElementById('dropzone');
    const fileInput = document.getElementById('file-input');

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('border-teal-500', 'bg-teal-50');
    });
    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('border-teal-500', 'bg-teal-50');
    });
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('border-teal-500', 'bg-teal-50');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) handleFile(file);
    });
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleFile(file);
    });
});


/* ── Page Navigation ── */
function showPage(pageName) {
    sessionStorage.setItem("currentPage", pageName);
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-link, .mobile-nav-link').forEach(l => l.classList.remove('active'));
    document.getElementById('page-' + pageName).classList.add('active');
    document.querySelectorAll('[data-page="' + pageName + '"]').forEach(l => l.classList.add('active'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
}


/* ── File preview ── */
function handleFile(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        window.originalImage = e.target.result;   // store for PDF
        document.getElementById('preview-image').src = e.target.result;
        document.getElementById('file-name').textContent = file.name;
        document.getElementById('file-size').textContent = (file.size / 1024 / 1024).toFixed(2) + " MB";
        document.getElementById('dropzone').classList.add('hidden');
        document.getElementById('formats').classList.add('hidden');
        document.getElementById('preview-section').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
}

function removeFile() {
    document.getElementById('file-input').value = "";
    document.getElementById('preview-image').src = "";
    document.getElementById('preview-section').classList.add('hidden');
    document.getElementById('dropzone').classList.remove('hidden');
    document.getElementById('formats').classList.remove('hidden');
    window.originalImage = null;
    window.spineReport   = null;
    window.detectedImage = null;
}


/* ── Analyze Image ── */
async function analyzeImage(event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }

    const fileInput = document.getElementById("file-input");
    const file = fileInput.files[0];
    if (!file) { alert("Please upload an image first."); return; }

    document.getElementById("progress-section").classList.remove("hidden");
    document.getElementById("action-buttons").classList.add("hidden");

    try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("http://127.0.0.1:8000/detect", {
            method: "POST",
            body: formData
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || `Server error ${response.status}`);
        }

        const data = await response.json();

        // Store globally for PDF generation
        window.spineReport   = data.report;
        window.detectedImage = data.annotated_image;

        showPage("results");

        // 1. Annotated image
        const resultImage = document.getElementById("result-image");
        const placeholder = document.getElementById("result-placeholder");
        resultImage.src   = data.annotated_image;
        resultImage.classList.remove("hidden");
        placeholder.classList.add("hidden");

        // 2. Overall confidence (from backend — excludes Not Detected)
        const overallConf       = data.report.overall_confidence;
        const confidencePercent = overallConf !== null
            ? (overallConf * 100).toFixed(1)
            : "0.0";
        document.getElementById("confidence-text").textContent = confidencePercent + "%";
        document.getElementById("confidence-bar").style.width  = confidencePercent + "%";

        // 3. Detection summary counts
        const counts = data.report.summary || {};
        document.getElementById("normal-count").textContent       = counts.Normal       ?? 0;
        document.getElementById("bulging-count").textContent      = counts.Bulging      ?? 0;
        document.getElementById("herniation-count").textContent   = counts.Herniation   ?? 0;
        document.getElementById("not-detected-count").textContent = counts.Not_Detected ?? 0;

        // 4. Overall status + badge + notes
        const condition = data.report.overall_status;
        document.getElementById("condition-text").textContent = condition;

        const dot       = document.getElementById("condition-dot");
        const riskBadge = document.getElementById("risk-badge");
        dot.className   = "w-4 h-4 rounded-full";

        document.getElementById("herniation-note").classList.add("hidden");
        document.getElementById("note-bulging").classList.add("hidden");
        document.getElementById("note-normal").classList.add("hidden");

        if (condition === "Critical") {
            dot.classList.add("bg-red-500");
            riskBadge.textContent = "High Risk";
            riskBadge.className   = "px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700";
            document.getElementById("herniation-note").classList.remove("hidden");
        } else if (condition === "Attention Required") {
            dot.classList.add("bg-amber-500");
            riskBadge.textContent = "Moderate Risk";
            riskBadge.className   = "px-3 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700";
            document.getElementById("note-bulging").classList.remove("hidden");
        } else {
            dot.classList.add("bg-emerald-500");
            riskBadge.textContent = "Normal";
            riskBadge.className   = "px-3 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700";
            document.getElementById("note-normal").classList.remove("hidden");
        }

        // 5. Class Wise Details — mapped by disc_level
        const discIdMap = {
            "L1-L2": "l1-l2-class",
            "L2-L3": "l2-l3-class",
            "L3-L4": "l3-l4-class",
            "L4-L5": "l4-l5-class",
            "L5-S1": "l5-s1-class",
        };

        data.report.discs.forEach(disc => {
            const spanId = discIdMap[disc.disc_level];
            if (!spanId) return;
            const span = document.getElementById(spanId);
            if (!span) return;
            span.textContent = disc.condition;
            if      (disc.severity === "severe")   span.className = "font-bold text-red-500 text-lg";
            else if (disc.severity === "moderate") span.className = "font-bold text-amber-500 text-lg";
            else if (disc.severity === "low")      span.className = "font-bold text-emerald-500 text-lg";
            else                                   span.className = "font-bold text-blue-500 text-lg";
        });

        // 6. Class Distribution donut
        const svg    = document.getElementById("progressChart");
        const colors = {
            "Normal":       "#10B981",
            "Bulging":      "#F59E0B",
            "Herniation":   "#EF4444",
            "Not_Detected": "#3B82F6",
        };

        while (svg.children.length > 1) svg.removeChild(svg.lastChild);

        const total = Object.values(counts).reduce((sum, val) => sum + val, 0);
        let cumulative = 0;

        Object.entries(counts).forEach(([key, value]) => {
            const legendEl = document.getElementById(key);
            if (legendEl) legendEl.textContent = total > 0
                ? ((value / total) * 100).toFixed(0) : 0;

            if (value === 0) return;

            const percentage = (value / total) * 100;
            const circle     = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            circle.setAttribute("cx",                "18");
            circle.setAttribute("cy",                "18");
            circle.setAttribute("r",                 "15.915");
            circle.setAttribute("fill",              "transparent");
            circle.setAttribute("stroke",            colors[key] || "#ccc");
            circle.setAttribute("stroke-width",      "3");
            circle.setAttribute("stroke-dasharray",  `${percentage} ${100 - percentage}`);
            circle.setAttribute("stroke-dashoffset", `-${cumulative}`);
            cumulative += percentage;
            svg.appendChild(circle);
        });

        // 7. Metrics Comparison
        const metrics   = data.report.metrics;
        const metricMap = [
            { key: "mAP",       barId: "metric-map",       labelId: "metric-map-label"      },
            { key: "precision", barId: "metric-precision",  labelId: "metric-precision-label" },
            { key: "recall",    barId: "metric-recall",     labelId: "metric-recall-label"    },
            { key: "f1_score",  barId: "metric-f1",        labelId: "metric-f1-label"        },
        ];

        metricMap.forEach(({ key, barId, labelId }) => {
            const pct   = metrics[key] !== undefined ? (metrics[key] * 100).toFixed(0) + "%" : "N/A";
            const width = metrics[key] !== undefined ? (metrics[key] * 100).toFixed(1) + "%" : "0%";
            const bar   = document.getElementById(barId);
            const label = document.getElementById(labelId);
            if (bar)   { bar.style.width = width; bar.textContent = pct; }
            if (label) label.textContent = pct;
        });

    } catch (error) {
        console.error(error);
        alert("Detection failed: " + error.message);
    } finally {
        document.getElementById("progress-section").classList.add("hidden");
        document.getElementById("action-buttons").classList.remove("hidden");
    }
}


/* ================================================================
   PDF GENERATION  —  jsPDF (loaded via CDN in index.html)
================================================================ */
function generatePDF(patientData) {
    const report = window.spineReport;
    if (!report) {
        alert("No detection data found. Please run an analysis first.");
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc      = new jsPDF({ unit: "mm", format: "a4" });
    const pageW    = 210;
    const pageH    = 297;
    const margin   = 15;
    const contentW = pageW - margin * 2;
    let   y        = 0;

    // Color palette
    const C = {
        teal:       [20,  184, 166],
        tealDark:   [13,  148, 136],
        tealLight:  [204, 245, 241],
        white:      [255, 255, 255],
        black:      [15,  23,  42],
        gray:       [100, 116, 139],
        grayLight:  [241, 245, 249],
        grayBorder: [226, 232, 240],
        red:        [239, 68,  68],
        amber:      [245, 158, 11],
        green:      [16,  185, 129],
        blue:       [59,  130, 246],
    };

    function fillRect(x, ry, w, h, color) {
        doc.setFillColor(...color);
        doc.rect(x, ry, w, h, "F");
    }

    function conditionColor(condition) {
        if (condition === "Herniation") return C.red;
        if (condition === "Bulging")    return C.amber;
        if (condition === "Normal")     return C.green;
        return C.blue;
    }

    function drawPageFooter() {
        const fy = pageH - 14;
        doc.setDrawColor(...C.grayBorder);
        doc.setLineWidth(0.3);
        doc.line(margin, fy - 3, pageW - margin, fy - 3);
        doc.setFontSize(7);
        doc.setTextColor(...C.gray);
        doc.setFont("helvetica", "italic");
        doc.text(
            "AI-generated report — for clinical reference only. Not a substitute for professional medical advice.",
            margin, fy + 1
        );
        doc.setFont("helvetica", "normal");
        doc.text(
            `Page ${doc.getCurrentPageInfo().pageNumber}`,
            pageW - margin, fy + 1, { align: "right" }
        );
    }

    function newPage() {
        doc.addPage();
        y = margin;
        drawPageFooter();
    }

    function ensureSpace(needed) {
        if (y + needed > pageH - 25) newPage();
    }

    // ── WATERMARK helper (applied to all pages at end) ────────────
    function drawWatermark(pageNum) {
        doc.setPage(pageNum);
        doc.saveGraphicsState();
        doc.setGState(new doc.GState({ opacity: 0.06 }));
        doc.setTextColor(...C.teal);
        doc.setFontSize(52);
        doc.setFont("helvetica", "bold");
        doc.text("CONFIDENTIAL", pageW / 2, pageH / 2, { align: "center", angle: 45 });
        doc.restoreGraphicsState();
    }

    // ================================================================
    //  PAGE 1 HEADER
    // ================================================================
    fillRect(0, 0, pageW, 42, C.teal);
    fillRect(0, 38, pageW, 4, C.tealDark);

    // Logo circle
    fillRect(margin, 7, 22, 22, C.tealDark);
    doc.setTextColor(...C.white);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("S", margin + 11, 21, { align: "center" });

    // Title + subtitle
    doc.setFontSize(17);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.white);
    doc.text("Lumbar Spine Damage Detection Report", margin + 27, 16);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text("AI Spine Diagnostic System  •  Powered by YOLOv8", margin + 27, 24);

    // Detection ID + date/time (top right)
    const detectionId = report.image_name
        ? "DET-" + report.image_name.replace(/[^a-zA-Z0-9]/g, "").substring(0, 8).toUpperCase()
        : "DET-UNKNOWN";
    const dateObj = new Date(report.timestamp || new Date().toISOString());
    const dateStr = dateObj.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const timeStr = dateObj.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });

    doc.setFontSize(8);
    doc.setTextColor(...C.tealLight);
    doc.text(`Detection ID : ${detectionId}`, pageW - margin, 14, { align: "right" });
    doc.text(`Date         : ${dateStr}`,      pageW - margin, 20, { align: "right" });
    doc.text(`Time         : ${timeStr}`,      pageW - margin, 26, { align: "right" });

    y = 50;
    drawPageFooter();

    // ================================================================
    //  SECTION 2 — PERSONAL DETAILS
    // ================================================================
    fillRect(margin, y, contentW, 8, C.tealLight);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.tealDark);
    doc.text("  Patient Information", margin + 2, y + 5.5);
    y += 12;

    const infoRows = [
        ["Patient Name",  patientData.name   || "—",  "Detection ID", detectionId],
        ["Date of Birth", patientData.dob    || "—",  "Age",          patientData.age    ? patientData.age + " years" : "—"],
        ["Gender",        patientData.gender || "—",  "Weight",       patientData.weight ? patientData.weight + " kg" : "—"],
        ["Report Date",   dateStr,                    "Report Time",  timeStr],
    ];

    const colW = contentW / 2 - 2;
    const rowH = 9;

    infoRows.forEach((row, i) => {
        const ry = y + i * rowH;
        if (i % 2 === 0) fillRect(margin, ry, contentW, rowH, C.grayLight);

        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...C.gray);
        doc.text(row[0] + ":", margin + 3, ry + 6);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...C.black);
        doc.text(String(row[1]), margin + 40, ry + 6);

        doc.setFont("helvetica", "normal");
        doc.setTextColor(...C.gray);
        doc.text(row[2] + ":", margin + colW + 5, ry + 6);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...C.black);
        doc.text(String(row[3]), margin + colW + 44, ry + 6);
    });

    y += infoRows.length * rowH + 10;

    // ================================================================
    //  SECTION 3 & 4 — IMAGES SIDE BY SIDE
    // ================================================================
    ensureSpace(90);

    fillRect(margin, y, contentW, 8, C.tealLight);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.tealDark);
    doc.text("  Scan Images", margin + 2, y + 5.5);
    y += 12;

    const imgW = (contentW - 6) / 2;
    const imgH = 70;

    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.gray);
    doc.text("Original MRI Image",  margin + imgW / 2,             y, { align: "center" });
    doc.text("AI Detection Result", margin + imgW + 6 + imgW / 2,  y, { align: "center" });
    y += 4;

    doc.setDrawColor(...C.grayBorder);
    doc.setLineWidth(0.4);
    doc.rect(margin, y, imgW, imgH);
    doc.rect(margin + imgW + 6, y, imgW, imgH);

    if (window.originalImage) {
        try   { doc.addImage(window.originalImage, "JPEG", margin + 1, y + 1, imgW - 2, imgH - 2, "", "FAST"); }
        catch { doc.setFontSize(8); doc.setTextColor(...C.gray); doc.text("Image unavailable", margin + imgW / 2, y + imgH / 2, { align: "center" }); }
    }

    if (window.detectedImage) {
        try   { doc.addImage(window.detectedImage, "JPEG", margin + imgW + 7, y + 1, imgW - 2, imgH - 2, "", "FAST"); }
        catch { doc.setFontSize(8); doc.setTextColor(...C.gray); doc.text("Image unavailable", margin + imgW + 6 + imgW / 2, y + imgH / 2, { align: "center" }); }
    }

    y += imgH + 10;

    // ================================================================
    //  SECTION 5 — DETECTION RESULTS TABLE
    // ================================================================
    ensureSpace(70);

    fillRect(margin, y, contentW, 8, C.tealLight);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.tealDark);
    doc.text("  Detection Results", margin + 2, y + 5.5);
    y += 12;

    // Table header
    const tCols = [
        { label: "Disc Level",       x: margin,       w: 38 },
        { label: "Condition",        x: margin + 38,  w: 45 },
        { label: "Confidence Score", x: margin + 83,  w: 48 },
        { label: "Severity",         x: margin + 131, w: 34 },
    ];

    fillRect(margin, y, contentW, 8, C.teal);
    tCols.forEach(col => {
        doc.setFontSize(8.5);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...C.white);
        doc.text(col.label, col.x + 3, y + 5.5);
    });
    y += 8;

    const tableStartY = y;
    (report.discs || []).forEach((disc, i) => {
        const rh    = 8;
        const color = conditionColor(disc.condition);

        fillRect(margin, y, contentW, rh, i % 2 === 0 ? C.white : C.grayLight);
        fillRect(margin, y, 3, rh, color);   // colored left accent

        const confPct      = disc.confidence > 0 ? (disc.confidence * 100).toFixed(1) + "%" : "—";
        const severityLabel = disc.severity === "unknown" ? "—"
            : disc.severity.charAt(0).toUpperCase() + disc.severity.slice(1);

        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...C.black);
        doc.text(disc.disc_level, tCols[0].x + 5, y + 5.5);

        doc.setTextColor(...color);
        doc.text(disc.condition, tCols[1].x + 3, y + 5.5);

        doc.setTextColor(...C.black);
        doc.setFont("helvetica", "normal");
        doc.text(confPct, tCols[2].x + 3, y + 5.5);

        // Mini confidence bar
        if (disc.confidence > 0) {
            const barMaxW = 20;
            fillRect(tCols[2].x + 20, y + 2.5, barMaxW,                  3, C.grayBorder);
            fillRect(tCols[2].x + 20, y + 2.5, barMaxW * disc.confidence, 3, color);
        }

        doc.setFont("helvetica", "bold");
        doc.setTextColor(...color);
        doc.text(severityLabel, tCols[3].x + 3, y + 5.5);

        y += rh;
    });

    // Table outer border
    doc.setDrawColor(...C.grayBorder);
    doc.setLineWidth(0.3);
    doc.rect(margin, tableStartY - 8, contentW, y - tableStartY + 8);

    y += 10;

    // ================================================================
    //  SECTION 6 — SUMMARY
    // ================================================================
    ensureSpace(55);

    fillRect(margin, y, contentW, 8, C.tealLight);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.tealDark);
    doc.text("  Detection Summary", margin + 2, y + 5.5);
    y += 12;

    const summary    = report.summary || {};
    const totalDiscs = (summary.Normal || 0) + (summary.Bulging || 0)
                     + (summary.Herniation || 0) + (summary.Not_Detected || 0);

    const summaryItems = [
        { label: "Total Analyzed", value: String(totalDiscs),               color: C.teal  },
        { label: "Normal",         value: String(summary.Normal      || 0), color: C.green },
        { label: "Bulging",        value: String(summary.Bulging     || 0), color: C.amber },
        { label: "Herniation",     value: String(summary.Herniation  || 0), color: C.red   },
        { label: "Not Detected",   value: String(summary.Not_Detected|| 0), color: C.blue  },
    ];

    const boxW = (contentW - 8) / summaryItems.length;
    summaryItems.forEach((item, i) => {
        const bx = margin + i * (boxW + 2);
        fillRect(bx, y, boxW, 22, C.grayLight);
        fillRect(bx, y, boxW, 3,  item.color);
        doc.setFontSize(16);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...item.color);
        doc.text(item.value, bx + boxW / 2, y + 14, { align: "center" });
        doc.setFontSize(7);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...C.gray);
        doc.text(item.label, bx + boxW / 2, y + 20, { align: "center" });
    });

    y += 30;

    // Overall status banner
    const statusColor = report.overall_status === "Critical"           ? C.red
                      : report.overall_status === "Attention Required" ? C.amber
                      : C.green;

    fillRect(margin, y, contentW, 10, statusColor);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.white);
    doc.text(
        `Overall Status: ${report.overall_status}   |   Overall Confidence: ${
            report.overall_confidence !== null
                ? (report.overall_confidence * 100).toFixed(1) + "%"
                : "N/A"
        }`,
        pageW / 2, y + 6.8, { align: "center" }
    );
    y += 18;

    // ================================================================
    //  SECTION 7 — MEDICAL EXPLANATION
    // ================================================================
    ensureSpace(30);

    fillRect(margin, y, contentW, 8, C.tealLight);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.tealDark);
    doc.text("  Medical Explanation", margin + 2, y + 5.5);
    y += 14;

    const explanations = [
        {
            title: "Normal Disc",
            color: C.green,
            text:  "A normal intervertebral disc maintains its natural shape and position within the spinal column. It provides adequate cushioning and support with no signs of degeneration, protrusion, or nerve compression.",
        },
        {
            title: "Bulging Disc",
            color: C.amber,
            text:  "A bulging disc occurs when the outer fibrous ring (annulus fibrosus) weakens and the disc extends beyond its normal boundary. This may cause localized back pain, stiffness, or mild nerve irritation depending on severity and location.",
        },
        {
            title: "Disc Herniation",
            color: C.red,
            text:  "Disc herniation (also called a ruptured or slipped disc) occurs when the inner nucleus pulposus pushes through a tear in the outer ring. This can compress adjacent nerves causing radiculopathy, numbness, or weakness in the limbs. Immediate medical evaluation is strongly recommended.",
        },
    ];

    explanations.forEach(exp => {
        ensureSpace(30);
        fillRect(margin,     y, 3,            24, exp.color);
        fillRect(margin + 3, y, contentW - 3, 24, C.grayLight);
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...exp.color);
        doc.text(exp.title, margin + 8, y + 7);
        doc.setFontSize(7.5);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...C.black);
        const lines = doc.splitTextToSize(exp.text, contentW - 12);
        doc.text(lines, margin + 8, y + 14);
        y += 28;
    });

    // Clinical note box
    y += 4;
    ensureSpace(20);
    fillRect(margin, y, contentW, 18, [255, 251, 235]);
    doc.setDrawColor(...C.amber);
    doc.setLineWidth(0.5);
    doc.rect(margin, y, contentW, 18);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.amber);
    doc.text("  Clinical Note", margin + 4, y + 6);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(120, 80, 0);
    const noteLines = doc.splitTextToSize(
        "This report is generated by an AI system trained on lumbar spine MRI data. Results should be reviewed by a qualified radiologist or spine specialist before any clinical decisions are made. This tool is intended to assist, not replace, professional medical judgment.",
        contentW - 8
    );
    doc.text(noteLines, margin + 4, y + 12);
    y += 22;

    // ================================================================
    //  WATERMARK ON ALL PAGES
    // ================================================================
    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) drawWatermark(p);

    // ================================================================
    //  SAVE
    // ================================================================
    const safeName = (patientData.name || "Patient").replace(/\s+/g, "_");
    const dateTag  = new Date().toISOString().slice(0, 10);
    doc.save(`SpineAI_Report_${safeName}_${dateTag}.pdf`);
}


/* ================================================================
   DARK MODE
================================================================ */
function applyDarkMode(enable) {
    const html     = document.documentElement;
    const sunIcon  = document.getElementById('sun-icon');
    const moonIcon = document.getElementById('moon-icon');
    if (enable) {
        html.classList.add('dark');
        sunIcon.classList.remove('hidden');
        moonIcon.classList.add('hidden');
    } else {
        html.classList.remove('dark');
        sunIcon.classList.add('hidden');
        moonIcon.classList.remove('hidden');
    }
    localStorage.setItem('darkMode', enable);
}

function toggleDarkMode() {
    const isDark = document.documentElement.classList.contains('dark');
    applyDarkMode(!isDark);
}


/* ================================================================
   MOBILE MENU
================================================================ */
function toggleMobileMenu() {
    const menu    = document.getElementById("mobile-menu");
    const overlay = document.getElementById("mobile-overlay");
    const isOpen  = !menu.classList.contains("translate-x-full");
    menu.classList.toggle("translate-x-full", isOpen);
    overlay.classList.toggle("hidden", isOpen);
    document.getElementById("menu-icon").classList.toggle("hidden", !isOpen);
    document.getElementById("close-icon").classList.toggle("hidden", isOpen);
}


/* ================================================================
   REPORT MODAL
================================================================ */
function openReportModal() {
    if (!window.spineReport) {
        alert("Please run an analysis first before generating a report.");
        return;
    }
    const overlay = document.getElementById('report-modal-overlay');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    document.getElementById('r-name').value   = '';
    document.getElementById('r-dob').value    = new Date().toISOString().split('T')[0];
    document.getElementById('r-age').value    = '';
    document.getElementById('r-weight').value = '';
    document.querySelectorAll('input[name="r-gender"]').forEach(r => r.checked = false);
    document.getElementById('r-error').classList.remove('show');
    document.getElementById('r-error').textContent = '';
    document.getElementById('r-success').classList.remove('show');
    document.querySelectorAll('.rform-input').forEach(i => i.classList.remove('r-error'));
}

function closeReportModal() {
    document.getElementById('report-modal-overlay').classList.remove('active');
    document.body.style.overflow = '';
}

function handleReportOverlayClick(e) {
    if (e.target === document.getElementById('report-modal-overlay')) closeReportModal();
}

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeReportModal();
});

function handleReportDownload() {
    const name      = document.getElementById('r-name').value.trim();
    const dob       = document.getElementById('r-dob').value;
    const gender    = document.querySelector('input[name="r-gender"]:checked');
    const errorEl   = document.getElementById('r-error');
    const successEl = document.getElementById('r-success');

    errorEl.classList.remove('show');
    errorEl.textContent = '';
    successEl.classList.remove('show');
    document.querySelectorAll('.rform-input').forEach(i => i.classList.remove('r-error'));

    if (!name) {
        errorEl.textContent = 'Full Name is required.';
        errorEl.classList.add('show');
        document.getElementById('r-name').classList.add('r-error');
        document.getElementById('r-name').focus();
        return;
    }
    if (!dob) {
        errorEl.textContent = 'Date of Birth is required.';
        errorEl.classList.add('show');
        document.getElementById('r-dob').classList.add('r-error');
        return;
    }
    if (!gender) {
        errorEl.textContent = 'Please select a gender.';
        errorEl.classList.add('show');
        return;
    }

    generatePDF({
        name:   name,
        dob:    dob,
        age:    document.getElementById('r-age').value    || "",
        gender: gender.value,
        weight: document.getElementById('r-weight').value || "",
    });

    successEl.classList.add('show');
    setTimeout(() => closeReportModal(), 1800);
}