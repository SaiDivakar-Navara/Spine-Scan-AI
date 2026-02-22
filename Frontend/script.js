// SpineAI JavaScript

// Page Navigation
function showPage(pageName) {
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.querySelectorAll('.nav-link, .mobile-nav-link').forEach(link => link.classList.remove('active'));
    
    document.getElementById('page-' + pageName).classList.add('active');
    document.querySelectorAll('[data-page="' + pageName + '"]').forEach(link => link.classList.add('active'));
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Dark Mode Toggle
function toggleDarkMode() {
    document.documentElement.classList.toggle('dark');
    const isDark = document.documentElement.classList.contains('dark');
    localStorage.setItem('darkMode', isDark);
    
    document.getElementById('sun-icon').classList.toggle('hidden', !isDark);
    document.getElementById('moon-icon').classList.toggle('hidden', isDark);
}

// Initialize dark mode from localStorage
if (localStorage.getItem('darkMode') === 'true') {
    document.documentElement.classList.add('dark');
    document.getElementById('sun-icon').classList.remove('hidden');
    document.getElementById('moon-icon').classList.add('hidden');
}

// Mobile Menu Toggle
function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    const overlay = document.getElementById('mobile-overlay');
    const menuIcon = document.getElementById('menu-icon');
    const closeIcon = document.getElementById('close-icon');
    
    const isOpen = !menu.classList.contains('translate-x-full');
    
    menu.classList.toggle('translate-x-full', isOpen);
    overlay.classList.toggle('hidden', isOpen);
    menuIcon.classList.toggle('hidden', !isOpen);
    closeIcon.classList.toggle('hidden', isOpen);
}

// File Upload
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const previewSection = document.getElementById('preview-section');
const previewImage = document.getElementById('preview-image');
const formats = document.getElementById('formats');

dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('border-teal-500', 'bg-teal-50');
});

dropzone.addEventListener('dragleave', (e) => {
    e.preventDefault();
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
    if (file) handleFile(file);
});

function handleFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        previewImage.src = e.target.result;
        document.getElementById('file-name').textContent = file.name;
        document.getElementById('file-size').textContent = (file.size / 1024 / 1024).toFixed(2) + ' MB';
        
        dropzone.classList.add('hidden');
        formats.classList.add('hidden');
        previewSection.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
}

function removeFile() {
    fileInput.value = '';
    previewImage.src = '';
    previewSection.classList.add('hidden');
    dropzone.classList.remove('hidden');
    formats.classList.remove('hidden');
    document.getElementById('progress-section').classList.add('hidden');
    document.getElementById('action-buttons').classList.remove('hidden');
}

function analyzeImage() {
    const progressSection = document.getElementById('progress-section');
    const actionButtons = document.getElementById('action-buttons');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    
    progressSection.classList.remove('hidden');
    actionButtons.classList.add('hidden');
    
    let progress = 0;
    const interval = setInterval(() => {
        progress += Math.random() * 15;
        if (progress >= 100) {
            progress = 100;
            clearInterval(interval);
            setTimeout(() => showPage('results'), 500);
        }
        progressBar.style.width = progress + '%';
        progressText.textContent = Math.round(progress) + '%';
    }, 200);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    showPage('home');
});