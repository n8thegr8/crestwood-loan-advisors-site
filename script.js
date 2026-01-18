document.addEventListener('DOMContentLoaded', () => {
    const burger = document.querySelector('.burger-menu');
    const navUl = document.querySelector('nav ul');

    if (burger && navUl) {
        burger.addEventListener('click', () => {
            navUl.classList.toggle('active');
            burger.classList.toggle('toggle');
        });
    }
});
