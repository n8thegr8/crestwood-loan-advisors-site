document.addEventListener('DOMContentLoaded', () => {
    const burger = document.querySelector('.burger-menu');
    const navUl = document.querySelector('nav ul');

    if (burger && navUl) {
        burger.addEventListener('click', () => {
            navUl.classList.toggle('active');
            burger.classList.toggle('toggle');
        });
    }

    // Lightbox Functionality
    const images = Array.from(document.querySelectorAll('main img'));
    if (images.length === 0) return;

    // Create Modal Elements
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <span class="close-modal">&times;</span>
        <img class="modal-content" id="modal-img">
        <div class="modal-caption" id="modal-caption"></div>
        <a class="modal-prev">&#10094;</a>
        <a class="modal-next">&#10095;</a>
    `;
    document.body.appendChild(modal);

    const modalImg = document.getElementById('modal-img');
    const captionText = document.getElementById('modal-caption');
    let currentIndex = 0;

    const openModal = (index) => {
        currentIndex = index;
        modal.style.display = "block";
        modalImg.src = images[currentIndex].src;
        captionText.innerHTML = images[currentIndex].alt;
        document.body.style.overflow = 'hidden'; // Prevent scrolling
    };

    const closeModal = () => {
        modal.style.display = "none";
        document.body.style.overflow = 'auto';
    };

    const showNext = () => {
        currentIndex = (currentIndex + 1) % images.length;
        modalImg.src = images[currentIndex].src;
        captionText.innerHTML = images[currentIndex].alt;
    };

    const showPrev = () => {
        currentIndex = (currentIndex - 1 + images.length) % images.length;
        modalImg.src = images[currentIndex].src;
        captionText.innerHTML = images[currentIndex].alt;
    };

    images.forEach((img, index) => {
        img.addEventListener('click', () => openModal(index));
    });

    document.querySelector('.close-modal').addEventListener('click', closeModal);
    document.querySelector('.modal-next').addEventListener('click', (e) => {
        e.stopPropagation();
        showNext();
    });
    document.querySelector('.modal-prev').addEventListener('click', (e) => {
        e.stopPropagation();
        showPrev();
    });

    // Close on click outside the image
    modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.classList.contains('close-modal')) {
            closeModal();
        }
    });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (modal.style.display === "block") {
            if (e.key === "ArrowRight") showNext();
            if (e.key === "ArrowLeft") showPrev();
            if (e.key === "Escape") closeModal();
        }
    });
});
