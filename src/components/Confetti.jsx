export function fireConfetti() {
  const colors = ['#85A573', '#FFE29A', '#FF9E8B', '#CDEFD1'];
  for (let i = 0; i < 26; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    const size = 6 + Math.random() * 6;
    p.style.width = size + 'px'; p.style.height = size + 'px';
    p.style.left = Math.random() * 100 + 'vw';
    p.style.background = colors[Math.floor(Math.random() * colors.length)];
    p.style.transition = `transform ${1.2 + Math.random()}s ease-in, opacity ${1.2 + Math.random()}s ease-in`;
    document.body.appendChild(p);
    requestAnimationFrame(() => {
      p.style.transform = `translateY(${70 + Math.random() * 20}vh) rotate(${Math.random() * 360}deg)`;
      p.style.opacity = '0';
    });
    setTimeout(() => p.remove(), 2400);
  }
}
