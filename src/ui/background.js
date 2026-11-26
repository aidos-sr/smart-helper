export function initBackground() {
  (function () {
    const canvas = document.getElementById("bg-canvas");
    const ctx = canvas.getContext("2d");
    let W,
      H,
      mouseX = 0,
      mouseY = 0,
      frame = null,
      lastFrame = 0,
      dark = true;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const isDark = () =>
      document.documentElement.getAttribute("data-theme") !== "light";

    function resize() {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }

    // Fluid orb particles
    class Orb {
      constructor() {
        this.reset();
      }
      reset() {
        this.x = Math.random() * W;
        this.y = Math.random() * H;
        this.r = 180 + Math.random() * 280;
        this.vx = (Math.random() - 0.5) * 0.35;
        this.vy = (Math.random() - 0.5) * 0.35;
        this.phase = Math.random() * Math.PI * 2;
        this.speed = 0.003 + Math.random() * 0.004;
        // color
        const cols = isDark()
          ? [
              "rgba(0,212,255,",
              "rgba(124,58,237,",
              "rgba(0,255,136,",
              "rgba(79,90,200,",
            ]
          : [
              "rgba(0,120,200,",
              "rgba(90,50,200,",
              "rgba(0,160,90,",
              "rgba(60,80,180,",
            ];
        this.col = cols[Math.floor(Math.random() * cols.length)];
        this.alpha = (0.03 + Math.random() * 0.06) * (isDark() ? 1 : 0.5);
      }
      update(t) {
        this.phase += this.speed;
        this.x += this.vx + Math.sin(this.phase * 0.7) * 0.4;
        this.y += this.vy + Math.cos(this.phase * 0.5) * 0.4;
        // mouse attraction (subtle)
        const dx = mouseX - this.x,
          dy = mouseY - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0 && dist < 400) {
          this.x += (dx / dist) * 0.15;
          this.y += (dy / dist) * 0.15;
        }
        if (this.x < -this.r) this.x = W + this.r;
        if (this.x > W + this.r) this.x = -this.r;
        if (this.y < -this.r) this.y = H + this.r;
        if (this.y > H + this.r) this.y = -this.r;
      }
      draw() {
        const g = ctx.createRadialGradient(
          this.x,
          this.y,
          0,
          this.x,
          this.y,
          this.r,
        );
        g.addColorStop(0, this.col + this.alpha + ")");
        g.addColorStop(1, this.col + "0)");
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
      }
    }

    // Floating nodes (connection network)
    class Node {
      constructor() {
        this.reset();
      }
      reset() {
        this.x = Math.random() * W;
        this.y = Math.random() * H;
        this.vx = (Math.random() - 0.5) * 0.5;
        this.vy = (Math.random() - 0.5) * 0.5;
        this.r = 1.5 + Math.random() * 2;
      }
      update() {
        this.x += this.vx;
        this.y += this.vy;
        if (this.x < 0 || this.x > W) this.vx *= -1;
        if (this.y < 0 || this.y > H) this.vy *= -1;
      }
      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fillStyle = dark ? "rgba(0,212,255,.35)" : "rgba(0,100,200,.25)";
        ctx.fill();
      }
    }

    let orbs, nodes;
    function init() {
      orbs = Array.from({ length: 7 }, () => new Orb());
      nodes = Array.from(
        { length: window.innerWidth < 700 ? 20 : 40 },
        () => new Node(),
      );
    }

    const CONN_DIST = 130;
    function drawConnections() {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const squared = dx * dx + dy * dy;
          if (squared < CONN_DIST * CONN_DIST) {
            const alpha =
              (1 - Math.sqrt(squared) / CONN_DIST) * (dark ? 0.18 : 0.1);
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.strokeStyle = dark
              ? `rgba(0,212,255,${alpha})`
              : `rgba(0,100,200,${alpha})`;
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }
        }
      }
    }

    function draw(t = 0) {
      frame = null;
      if (
        document.hidden ||
        document.getElementById("pg-chat").classList.contains("on")
      )
        return;
      if (!reduced.matches && t - lastFrame < 33) {
        frame = requestAnimationFrame(draw);
        return;
      }
      lastFrame = t;
      dark = isDark();
      ctx.clearRect(0, 0, W, H);
      // Orb layer
      orbs.forEach((o) => {
        if (!reduced.matches) o.update(t);
        o.draw();
      });
      // Node network layer
      nodes.forEach((n) => {
        if (!reduced.matches) n.update();
        n.draw();
      });
      drawConnections();
      if (!reduced.matches) frame = requestAnimationFrame(draw);
    }

    window.addEventListener("mousemove", (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    });
    window.addEventListener("resize", () => {
      resize();
      resume();
    });
    resize();
    init();
    frame = requestAnimationFrame(draw);
    function resume() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    }
    new MutationObserver(resume).observe(document.getElementById("pg-chat"), {
      attributes: true,
      attributeFilter: ["class"],
    });
    document.addEventListener("visibilitychange", resume);
    reduced.addEventListener("change", resume);

    // Re-init colors on theme change
    window._reinitBg = () => {
      orbs.forEach((o) => o.reset());
      if (reduced.matches) resume();
    };
  })();
}
