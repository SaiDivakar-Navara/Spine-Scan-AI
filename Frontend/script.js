// SpineAI JavaScript

document.addEventListener('DOMContentLoaded', () => {
    // Restore page
    const currentPage = sessionStorage.getItem("currentPage") || "home";
    showPage(currentPage);

    // ── Dark mode init ────────────────────────────────────────────────
    const savedDark = localStorage.getItem('darkMode') === 'true';
    applyDarkMode(savedDark);

    // File Upload Setup
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

        const response = await fetch("http://127.0.0.1:8000/predict/full/", {
            method: "POST",
            body: formData
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || `Server error ${response.status}`);
        }

        const data = await response.json();
        showPage("results");

        const resultImage  = document.getElementById("result-image");
        const placeholder  = document.getElementById("result-placeholder");
        resultImage.src    = data.annotated_image;
        resultImage.classList.remove("hidden");
        placeholder.classList.add("hidden");

        const discs = data.report.discs;
        const sum   = discs.reduce((acc, obj) => acc + obj.confidence, 0);
        const overall_confidence  = sum / discs.length;
        const confidencePercent   = (overall_confidence * 100).toFixed(1);
        document.getElementById("confidence-text").textContent = confidencePercent + "%";
        document.getElementById("confidence-bar").style.width  = confidencePercent + "%";

        const counts = data.report.summary || {};
        document.getElementById("normal-count").textContent      = counts.Normal      ?? 0;
        document.getElementById("bulging-count").textContent     = counts.Bulging     ?? 0;
        document.getElementById("herniation-count").textContent  = counts.Herniation  ?? 0;
        document.getElementById("not-detected-count").textContent = counts.Not_Detected ?? 0;

        const condition = data.report.overall_status;
        document.getElementById("condition-text").textContent = condition;

        const dot = document.getElementById("condition-dot");
        dot.className = "w-4 h-4 rounded-full";

        const riskBadge = document.getElementById("risk-badge");
        document.getElementById("herniation-note").classList.add("hidden");
        document.getElementById("note-bulging").classList.add("hidden");
        document.getElementById("note-normal").classList.add("hidden");

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

        const resultSpans = document.querySelectorAll('span[id$="-class"]');
        resultSpans.forEach((span, index) => {
            span.textContent = discs[index].condition;
            if      (discs[index].severity === "severe")   span.className = "font-bold text-red-500 text-lg";
            else if (discs[index].severity === "moderate") span.className = "font-bold text-amber-500 text-lg";
            else if (discs[index].severity === "low")      span.className = "font-bold text-emerald-500 text-lg";
            else                                           span.className = "font-bold text-blue-500 text-lg";
        });

        const colors = {
            "Normal":       "#10B981",
            "Bulging":      "#F59E0B",
            "Herniation":   "#EF4444",
            "Not_Detected": "#3B82F6"
        };

        const svg   = document.getElementById("progressChart");
        const total = Object.values(counts).reduce((sum, val) => sum + val, 0);
        let cumulative = 0;

        Object.entries(counts).forEach(([key, value]) => {
            if (value === 0) return;
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

    } catch (error) {
        console.error(error);
        alert("Detection failed: " + error.message);
    } finally {
        document.getElementById("progress-section").classList.add("hidden");
        document.getElementById("action-buttons").classList.remove("hidden");
    }
}


/* ================================================================
   DARK MODE — improved
================================================================ */

/**
 * Apply or remove dark mode and sync icon + localStorage.
 * @param {boolean} enable
 */
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
    const overlay = document.getElementById('report-modal-overlay');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Reset form
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

// Single keydown listener for both modal + Escape
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeReportModal();
});

function handleReportDownload() {
    const name      = document.getElementById('r-name').value.trim();
    const dob       = document.getElementById('r-dob').value;
    const gender    = document.querySelector('input[name="r-gender"]:checked');
    const errorEl   = document.getElementById('r-error');
    const successEl = document.getElementById('r-success');

    // Clear
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

    // Success — plug in your actual PDF generation here
    console.log('Report data:', {
        name,
        dob,
        age:    document.getElementById('r-age').value,
        gender: gender.value,
        weight: document.getElementById('r-weight').value,
    });

    successEl.classList.add('show');
}