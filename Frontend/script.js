let data = {};
let eval_data = {};
let PatientDetails = {};

let complete_objdetails = {};
let originalImageFile = null;

// SpineAI JavaScript
document.addEventListener('DOMContentLoaded', () => {
    // Restore page
    const currentPage = sessionStorage.getItem("currentPage") || "home";
    showPage(currentPage);
    // Dark mode init
    if (localStorage.getItem('darkMode') === 'true') {
        document.documentElement.classList.add('dark');
        document.getElementById('sun-icon').classList.remove('hidden');
        document.getElementById('moon-icon').classList.add('hidden');
    }
    // File Upload Setup
    const dropzone = document.getElementById('dropzone');
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
        if (file && file.type.startsWith('image/')) {
            handleFile(file);
        }
    });
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        originalImageFile = file;
        if (file) handleFile(file);
    });
});


// Page Navigation
function showPage(pageName) {
    sessionStorage.setItem("currentPage", pageName);
    document.querySelectorAll('.page').forEach(page =>
        page.classList.remove('active')
    );
    document.querySelectorAll('.nav-link, .mobile-nav-link').forEach(link =>
        link.classList.remove('active')
    );
    document.getElementById('page-' + pageName).classList.add('active');
    document.querySelectorAll('[data-page="' + pageName + '"]').forEach(link =>
        link.classList.add('active')
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Handle File Preview
function handleFile(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        document.getElementById('preview-image').src = e.target.result;
        document.getElementById('file-name').textContent = file.name;
        document.getElementById('file-size').textContent =
            (file.size / 1024 / 1024).toFixed(2) + " MB";
        document.getElementById('dropzone').classList.add('hidden');
        document.getElementById('formats').classList.add('hidden');
        document.getElementById('preview-section').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
}

// Remove file
function removeFile() {
    document.getElementById('file-input').value = "";
    document.getElementById('preview-image').src = "";
    document.getElementById('preview-section').classList.add('hidden');
    document.getElementById('dropzone').classList.remove('hidden');
    document.getElementById('formats').classList.remove('hidden');
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN DETECTION FUNCTION  (updated for /analyze-mri endpoint)
//
// Old endpoint : POST /detect
//   response   : { result_image_url, confidence, counts:{Normal,Bulging,Herniation} }
//
// New endpoint : POST /analyze-mri
//   response   : { output_image_url, overall_confidence,
//                  class_counts:{Normal,Bulging,Herniation},
//                  detections, risk_level }
// ────────────────────────────────────────────────────────────────────────────
async function analyzeImage(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    const fileInput = document.getElementById("file-input");
    const file = fileInput.files[0];
    if (!file) {
        alert("Please upload an image first.");
        return;
    }

    // Show progress bar, hide action buttons while request is in-flight
    document.getElementById("progress-section").classList.remove("hidden");
    document.getElementById("action-buttons").classList.add("hidden");

    try {
        const formData = new FormData();
        formData.append("file", file);

        
        const response = await fetch("http://127.0.0.1:8000/predict/full/", {
            method: "POST",
            body: formData
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || `Server error ${response.status}`);
        }

        data = await response.json();

        // ── Navigate to results page ──────────────────────────────────────
        showPage("results");

        // ── Output image ──────────────────────────────────────────────────
        // Old: data.result_image_url  (was a full URL or relative path)
        // New: data.output_image_url  (e.g. "/outputs/xxx_output.jpg")
        //      → prepend the backend base so the static file is fetched correctly
        const resultImage = document.getElementById("result-image");
        const placeholder = document.getElementById("result-placeholder");

        resultImage.src = data.annotated_image;
        resultImage.classList.remove("hidden");
        placeholder.classList.add("hidden");

        // ── Confidence score ──────────────────────────────────────────────
        // Old: data.confidence          (0–1 float)
        // New: data.overall_confidence  (0–1 float, identical format)

        const discs = data.report.discs;

        // Step 1: Remove "Not Detected"
        const validDiscs = discs.filter(d => 
            d.condition !== "Not_Detected"
        )

        let selectedDiscs = [];

        // Step 2: Priority logic
        if (validDiscs.some(d => d.condition === "Herniation")) {
            selectedDiscs = validDiscs.filter(d => d.condition === "Herniation");
        } 
        else if (validDiscs.some(d => d.condition === "Bulging")) {
            selectedDiscs = validDiscs.filter(d => d.condition === "Bulging");
        } 
        else {
            selectedDiscs = validDiscs.filter(d => d.condition === "Normal");
        }

        // Step 3: Calculate average
        const sum = selectedDiscs.reduce((acc, obj) => acc + obj.confidence, 0);
        const overall_confidence = sum / selectedDiscs.length;

        const confidencePercent = (overall_confidence * 100).toFixed(1);

        // Step 4: Display
        document.getElementById("confidence-text").textContent = confidencePercent + "%";
        document.getElementById("confidence-bar").style.width = confidencePercent + "%";

        // ── Detection counts ──────────────────────────────────────────────
        // Old: data.counts.Normal / .Bulging / .Herniation
        // New: data.class_counts.Normal / .Bulging / .Herniation
        const counts = data.report.summary || {};
        document.getElementById("normal-count").textContent = counts.Normal     ?? 0;
        document.getElementById("bulging-count").textContent = counts.Bulging    ?? 0;
        document.getElementById("herniation-count").textContent = counts.Herniation ?? 0;
        document.getElementById("not-detected-count").textContent = counts.Not_Detected ?? 0;

        // ── Determine dominant condition ──────────────────────────────────
        // Same priority logic as before: Herniation > Bulging > Normal
        const condition = data.report.overall_status;

        document.getElementById("condition-text").textContent = condition;

        // ── Coloured dot ──────────────────────────────────────────────────
        const dot = document.getElementById("condition-dot");
        dot.className = "w-4 h-4 rounded-full"; // reset first

        // ── Risk badge ────────────────────────────────────────────────────
        // Now comes directly from the backend via data.risk_level
        // ("High Risk" | "Low Risk" | "Normal") — no need to re-derive it
        const riskBadge = document.getElementById("risk-badge");

        // ── Notes: hide all first ─────────────────────────────────────────
        // Note: your HTML uses "herniation-note" (not "note-herniation")
        document.getElementById("herniation-note").classList.add("hidden");
        document.getElementById("note-bulging").classList.add("hidden");
        document.getElementById("note-normal").classList.add("hidden");

        // ── Apply per-condition styles ────────────────────────────────────
        if (condition === "Critical") {
            dot.classList.add("bg-red-500");
            riskBadge.textContent = data.risk_level || "High Risk";
            riskBadge.className   = "px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700";
            document.getElementById("herniation-note").classList.remove("hidden");
        } else if (condition === "Attention Required") {
            dot.classList.add("bg-amber-500");
            riskBadge.textContent = data.risk_level || "Low Risk";
            riskBadge.className   = "px-3 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700";
            document.getElementById("note-bulging").classList.remove("hidden");
        } else {
            dot.classList.add("bg-emerald-500");
            riskBadge.textContent = data.risk_level || "Normal";
            riskBadge.className   = "px-3 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700";
            document.getElementById("note-normal").classList.remove("hidden");
        }


        //class-wise results

        
        const resultSpans = document.querySelectorAll('span[id$="-class"]');
        resultSpans.forEach((span,index) => {
            span.textContent = discs[index].condition;
            if(discs[index].severity === "severe"){
                span.className = "font-bold text-red-500 text-lg"
            }
            else if(discs[index].severity === "moderate"){
                span.className = "font-bold text-amber-500 text-lg"
            }
            else if(discs[index].severity === "low"){
                span.className = "font-bold text-emerald-500 text-lg"
            }
            else{
                span.className = "font-bold text-gray-500 text-lg"
            }
        });


        const colors = {
            "Normal": "#10B981",    
            "Bulging": "#F59E0B",   
            "Herniation": "#EF4444",
            "Not_Detected": "gray"
        };

        const svg = document.getElementById("progressChart");

        // Calculate total
        const total = Object.values(counts).reduce((sum, val) => sum + val, 0);

        let cumulative = 0;

        Object.entries(counts).forEach(([key, value]) => {

        if (value === 0) return;  // Skip zero values (optional)

        const percentage = (value / total) * 100;

        document.getElementById(key).textContent = percentage;

        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");

        circle.setAttribute("cx", "18");
        circle.setAttribute("cy", "18");
        circle.setAttribute("r", "15.915");
        circle.setAttribute("fill", "transparent");
        circle.setAttribute("stroke", colors[key]);
        circle.setAttribute("stroke-width", "3");

        circle.setAttribute("stroke-dasharray", `${percentage} ${100 - percentage}`);
        circle.setAttribute("stroke-dashoffset", `-${cumulative}`);

        cumulative += percentage;

        svg.appendChild(circle);
        });

        loadMetrics();

    } catch (error) {
        console.error(error);
        alert("Detection failed: " + error.message);
    } finally {
        // Always restore UI — even if something throws
        document.getElementById("progress-section").classList.add("hidden");
        document.getElementById("action-buttons").classList.remove("hidden");
    }
}

function updateMetrics(data) {
    const map = Math.round(data.map50 * 100);
    const precision = Math.round(data.precision * 100);
    const recall = Math.round(data.recall * 100);

    // mAP
    document.getElementById("mapValue").textContent = map + "%";
    document.getElementById("mapBar").style.width = map + "%";
    document.getElementById("mapInside").textContent = map + "%";

    // Precision
    document.getElementById("precisionValue").textContent = precision + "%";
    document.getElementById("precisionBar").style.width = precision + "%";
    document.getElementById("precisionInside").textContent = precision + "%";

    // Recall
    document.getElementById("recallValue").textContent = recall + "%";
    document.getElementById("recallBar").style.width = recall + "%";
    document.getElementById("recallInside").textContent = recall + "%";
}

async function downloadReportAsPDF(data) {

    // const btn = document.getElementById("download-btn");
    // btn.textContent = "Generating PDF...";
    // btn.disabled    = true;

    try {
        // Send the entire object as a JSON string in FormData
        const formData = new FormData();
        formData.append("data", JSON.stringify(data));
        formData.append("original_image", originalImageFile);

            console.log("data being sent:", data);  // ← add this
    console.log("stringified:", JSON.stringify(data));  // ← and this
    console.log(originalImageFile);

        const response = await fetch("http://localhost:8000/generate-report", {
            method : "POST",
            body   : formData,
        });

        if (!response.ok) throw new Error("Failed to generate report");

        // Silent download — no dialog, no preview
        const blob     = await response.blob();
        const url      = URL.createObjectURL(blob);
        const a        = document.createElement("a");
        a.href         = url;
        a.download     = `spine_report_${data.patient.name}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

    } catch (err) {
        console.error("PDF generation failed:", err);
        alert("Failed to generate report. Please try again.");
    } finally {
        btn.textContent = "Download Report";
        btn.disabled    = false;
    }
}

async function loadMetrics() {
    const response = await fetch("http://127.0.0.1:8000/metrics");
    eval_data = await response.json();
    updateMetrics(eval_data);
}



// Dark Mode Toggle
function toggleDarkMode() {
    document.documentElement.classList.toggle('dark');
    const isDark = document.documentElement.classList.contains('dark');
    localStorage.setItem('darkMode', isDark);
    document.getElementById('sun-icon').classList.toggle('hidden', !isDark);
    document.getElementById('moon-icon').classList.toggle('hidden', isDark);
}

// Mobile Menu Toggle
function toggleMobileMenu() {
    const menu    = document.getElementById("mobile-menu");
    const overlay = document.getElementById("mobile-overlay");
    const isOpen  = !menu.classList.contains("translate-x-full");
    menu.classList.toggle("translate-x-full", isOpen);
    overlay.classList.toggle("hidden", isOpen);
    document.getElementById("menu-icon").classList.toggle("hidden", !isOpen);
    document.getElementById("close-icon").classList.toggle("hidden", isOpen);
}



// Generate Report Button

function openReportModal() {
    const overlay = document.getElementById('report-modal-overlay');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Reset form
    document.getElementById('r-name').value = '';
    document.getElementById('r-dob').value = '';
    document.getElementById('r-age').value = '';
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
    if (e.target === document.getElementById('report-modal-overlay')) {
        closeReportModal();
    }
}

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeReportModal();
});


function handleReportDownload() {
    const name   = document.getElementById('r-name').value.trim();
    const dob    = document.getElementById('r-dob').value;
    const gender = document.querySelector('input[name="r-gender"]:checked');
    const errorEl   = document.getElementById('r-error');
    const successEl = document.getElementById('r-success');

    // Clear previous state
    errorEl.classList.remove('show');
    errorEl.textContent = '';
    successEl.classList.remove('show');
    document.querySelectorAll('.rform-input').forEach(i => i.classList.remove('r-error'));

    // Validate
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

    // All valid — trigger your actual download/report logic here
    PatientDetails = {
        name,
        dob,
        age:    document.getElementById('r-age').value,
        gender: gender.value,
        weight: document.getElementById('r-weight').value,
    };
    successEl.classList.add('show');

    complete_objdetails = {
        patient : PatientDetails,
        report : data
    };


    downloadReportAsPDF(complete_objdetails);
    
}



// for Results Page

// function populateReport() {
//     const report  = data.report;
//     const patient = PatientDetails || {};
//     const now     = new Date().toISOString().replace("T"," ").slice(0,19);
//     const id      = "DET-" + Math.random().toString(36).substr(2,6).toUpperCase();
//     const detDate = report.timestamp.replace("T"," ").slice(0,19);

//     // console.log(report);
//     // console.log(patient);
//     // console.log(now);
//     // console.log(id);
//     // console.log(detDate);

//     complete_objdetails = {
//         patient : PatientDetails,
//         report : data
//     };

// console.log(complete_objdetails);

//     // ── Detection IDs everywhere ───────────────────────────
//     // ["p1-det-id","p2-det-id","foot1-det-id","foot2-det-id"]
//     //   .forEach(el => document.getElementById(el).textContent = id);

//     // // ── Dates ──────────────────────────────────────────────
//     // ["p1-generated","p2-generated"].forEach(el => document.getElementById(el).textContent = now);
//     // ["p1-det-date","p2-det-date"].forEach(el => document.getElementById(el).textContent = detDate);

//     // // ── Patient Details ────────────────────────────────────
//     // document.getElementById("pt-name").textContent   = patient.name   || "N/A";
//     // document.getElementById("pt-dob").textContent    = patient.dob    || "N/A";
//     // document.getElementById("pt-age").textContent    = patient.age    ? patient.age + " yrs" : "N/A";
//     // document.getElementById("pt-gender").textContent = patient.gender || "N/A";
//     // document.getElementById("pt-weight").textContent = patient.weight ? patient.weight + " kg" : "N/A";

//     // // ── Image filenames ────────────────────────────────────
//     // document.getElementById("orig-filename").textContent = report.image_name || "N/A";
//     // document.getElementById("det-filename").textContent  = report.image_name || "N/A";

//     // // ── Annotated image (base64 from /predict/full) ────────
//     // if (data.annotated_image) {
//     //   const ph  = document.getElementById("det-placeholder");
//     //   const img = document.createElement("img");
//     //   img.src   = data.annotated_image;
//     //   img.alt   = "Detected MRI";
//     //   ph.replaceWith(img);
//     // }

//     // // ── Results table ──────────────────────────────────────
//     // const badge = c => ({
//     //   "Normal"      : `<span class="badge-normal">✅ Normal</span>`,
//     //   "Bulging"     : `<span class="badge-bulging">⚠️ Bulging</span>`,
//     //   "Herniation"  : `<span class="badge-herniation">🔴 Herniation</span>`,
//     //   "Not Detected": `<span class="badge-notdetected">❓ Not Detected</span>`,
//     // })[c] || `<span class="badge-notdetected">${c}</span>`;

//     // const color = c => ({
//     //   "Normal":"var(--normal)","Bulging":"var(--bulging)",
//     //   "Herniation":"var(--herniation)","Not Detected":"var(--notfound)",
//     // })[c] || "var(--notfound)";

//     // document.getElementById("results-tbody").innerHTML = report.discs.map(d => {
//     //   const cv = d.confidence > 0 ? d.confidence.toFixed(2) : "N/A";
//     //   const cp = d.confidence > 0 ? (d.confidence*100).toFixed(1)+"%" : "N/A";
//     //   const bw = d.confidence > 0 ? (d.confidence*100)+"%" : "0%";
//     //   const cl = color(d.condition);
//     //   return `<tr>
//     //     <td class="disc-cell">${d.disc_level.replace("-"," – ")}</td>
//     //     <td>${badge(d.condition)}</td>
//     //     <td><div class="conf-bar-wrap">
//     //       <div class="conf-bar"><div class="conf-bar-fill" style="width:${bw};background:${cl}"></div></div>
//     //       <span class="conf-text" style="color:${cl}">${cv}</span>
//     //     </div></td>
//     //     <td><strong>${cp}</strong></td>
//     //   </tr>`;
//     // }).join("");

//     // // ── Summary counts ─────────────────────────────────────
//     // const s = report.summary;
//     // document.getElementById("sum-total").textContent       = 5;
//     // document.getElementById("sum-normal").textContent      = s.Normal        || 0;
//     // document.getElementById("sum-bulging").textContent     = s.Bulging       || 0;
//     // document.getElementById("sum-herniation").textContent  = s.Herniation    || 0;
//     // document.getElementById("sum-notdetected").textContent = s["Not Detected"]|| 0;

//     // // ── Overall Status Banner ──────────────────────────────
//     // const banner   = document.getElementById("status-banner");
//     // const stitle   = document.getElementById("status-title");
//     // const sdesc    = document.getElementById("status-desc");
//     // const affected = (s.Bulging||0) + (s.Herniation||0);

//     // if (report.overall_status === "Critical") {
//     //   banner.className = "status-banner critical";
//     //   stitle.textContent = "Overall Status: Critical";
//     //   sdesc.textContent  = `The AI model identified abnormalities in ${affected} of 5 analysed disc level(s): `
//     //     + `${s.Herniation||0} disc(s) show signs of Herniation; ${s.Bulging||0} disc(s) show Bulging. `
//     //     + `Clinical correlation and radiologist review are strongly recommended.`;
//     // } else if (report.overall_status === "Attention Required") {
//     //   banner.className = "status-banner attention";
//     //   stitle.textContent = "Overall Status: Attention Required";
//     //   sdesc.textContent  = `${s.Bulging||0} disc(s) show Bulging. Monitoring and clinical consultation advised.`;
//     // } else {
//     //   banner.className = "status-banner normal-status";
//     //   stitle.textContent = "Overall Status: Normal";
//     //   sdesc.textContent  = "All analysed disc levels appear normal. No significant abnormalities detected.";
//     // }

//     //console.log(data);
//   }

//   // ── Sample preview data (remove when connecting to real API) ─
//   populateReport({
//     patient: patientDetails,
//     report: {
//       image_name      : "sample_mri.jpg",
//       timestamp       : "2025-06-01T14:32:10",
//       processing_time : 0.42,
//       result : data.report
//     },
//     annotated_image: data.annotated_image
//   });
