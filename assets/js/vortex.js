/* ==========================================================================
   PokeMMO Farm Guide — vortex.js
   - Canvas full-bleed: anillos orbitales concéntricos, marcas radiales y
     brazos espirales luminosos girando en sentido antihorario.
   - Espiral de profundidad: los 9 nodos emergen pequeños desde el centro
     detrás del bloque central (.hero-core), cruzan hacia primer plano solo
     al despejar las dos zonas medidas (título principal + cuerpo inferior),
     crecen hacia los bordes, se desvanecen al salir y reaparecen de forma
     progresiva al volver al hero tras hacer scroll.
   - Pausa automática fuera de pantalla, en pestaña oculta y reduced motion.
   ========================================================================== */
(function () {
  'use strict';

  var MOBILE_BP = 768;
  var CYCLE_S = 32;
  var SPIRAL_SWEEP = 2.1;
  var GOLDEN_ANGLE = 2.3999632297;
  var INITIAL_SPREAD = 0.45;
  var REENTRY_STAGGER_MS = 65;
  var REENTRY_DURATION_MS = 420;
  var RIBBON_ROT_SPEED = 0.085;
  var TAU = Math.PI * 2;

  function clamp(min, max, val) {
    return val < min ? min : (val > max ? max : val);
  }

  function smoothstep(edge0, edge1, x) {
    var span = edge1 - edge0;
    if (span <= 0) return x >= edge1 ? 1 : 0;
    var t = clamp(0, 1, (x - edge0) / span);
    return t * t * (3 - 2 * t);
  }

  function initVortex() {
    var hero = document.getElementById('inicio');
    if (!hero) return;
    var stage = hero.querySelector('.vortex-stage');
    if (!stage) return;

    var coreEl = hero.querySelector('.hero-core');
    var wordmarkEl = hero.querySelector('.hero-wordmark');
    var subtitleEl = hero.querySelector('.hero-subtitle');
    var searchWrapEl = hero.querySelector('.hero-search-wrap');
    var factsEl = hero.querySelector('.hero-facts');
    var canvas = stage.querySelector('.vortex-canvas');
    var ctx = canvas ? canvas.getContext('2d') : null;
    var nodeEls = Array.prototype.slice.call(stage.querySelectorAll('.vortex-node'));
    if (!nodeEls.length) return;

    var reducedQuery = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;

    var state = {
      w: 0,
      h: 0,
      wmHalfW: 480,
      wmTop: -220,
      wmBottom: -130,
      bodyHalfW: 320,
      bodyTop: -130,
      bodyBottom: 220,
      dpr: 1,
      isMobile: false,
      isReduced: Boolean(reducedQuery && reducedQuery.matches),
      isHeroVisible: true,
      hasLeftView: false,
      reentryStart: 0,
      canvasAngle: 0,
      rafId: 0,
      lastTime: 0,
      palette: {
        isLight: false,
        border: 'rgba(255, 255, 255, 0.14)',
        borderStrong: 'rgba(255, 255, 255, 0.28)',
        ribbons: []
      }
    };

    var items = nodeEls.map(function (el, idx) {
      return {
        el: el,
        idx: idx,
        u: (idx + 0.5) / nodeEls.length,
        baseAngle: idx * GOLDEN_ANGLE + INITIAL_SPREAD,
        frozen: false,
        hoverBoost: 1
      };
    });

    /* --- Colores según tema activo --- */
    function readThemeColors() {
      var root = document.documentElement;
      var styles = window.getComputedStyle(root);
      var isLight = root.getAttribute('data-theme') === 'light';

      function cssVar(name, fallback) {
        var val = styles.getPropertyValue(name).trim();
        return val || fallback;
      }

      state.palette.isLight = isLight;
      state.palette.border = cssVar('--border', isLight ? 'rgba(16, 17, 20, 0.14)' : 'rgba(255, 255, 255, 0.12)');
      state.palette.borderStrong = cssVar('--border-strong', isLight ? 'rgba(16, 17, 20, 0.30)' : 'rgba(255, 255, 255, 0.24)');
      state.palette.ribbons = [
        cssVar('--cat-money', '#F5A623'),
        cssVar('--cat-items', '#4D8DFF'),
        cssVar('--cat-berries', '#F43F5E'),
        cssVar('--cat-alpha', '#8B5CF6'),
        cssVar('--cat-payday', '#3DD68C'),
        cssVar('--cat-farmeros', '#84CC16')
      ];
    }

    /* --- Geometría adaptable al hero y dos zonas de despeje en .hero-core --- */
    function getGeometry() {
      var w = state.w || hero.clientWidth || window.innerWidth || 1280;
      var h = state.h || hero.clientHeight || window.innerHeight || 840;
      var cx = w * 0.5;
      var cy = h * 0.5;
      var minDim = Math.min(w, h);
      var diagR = Math.hypot(cx, cy);
      var ryScale = state.isMobile
        ? 0.92
        : clamp(0.76, 1.0, (h / Math.max(1, w)) * 1.16);
      return {
        w: w,
        h: h,
        cx: cx,
        cy: cy,
        minDim: minDim,
        diagR: diagR,
        rMin: minDim * 0.20,
        rMax: diagR * 0.98,
        ryScale: ryScale
      };
    }

    function measure() {
      var winW = window.innerWidth || hero.clientWidth || 1024;
      state.isMobile = winW < MOBILE_BP;
      var heroRect = hero.getBoundingClientRect();
      var targetRect = state.isMobile ? stage.getBoundingClientRect() : heroRect;
      var w = Math.max(1, Math.round(targetRect.width || winW));
      var h = Math.max(1, Math.round(targetRect.height || 360));

      state.w = w;
      state.h = h;
      state.dpr = Math.min(window.devicePixelRatio || 1, 2);

      var heroCx = heroRect.left + heroRect.width * 0.5;
      var heroCy = heroRect.top + heroRect.height * 0.5;
      var coreRect = coreEl ? coreEl.getBoundingClientRect() : null;
      var wmRect = wordmarkEl ? wordmarkEl.getBoundingClientRect() : null;
      var subRect = subtitleEl ? subtitleEl.getBoundingClientRect() : null;
      var searchRect = searchWrapEl ? searchWrapEl.getBoundingClientRect() : null;
      var factsRect = factsEl ? factsEl.getBoundingClientRect() : null;

      if (wmRect && wmRect.width > 0) {
        state.wmHalfW = wmRect.width * 0.5;
        state.wmTop = wmRect.top - heroCy;
        state.wmBottom = wmRect.bottom - heroCy;
      } else if (coreRect && coreRect.width > 0) {
        state.wmHalfW = coreRect.width * 0.5;
        state.wmTop = coreRect.top - heroCy;
        state.wmBottom = state.wmTop + 90;
      }

      var subHalfW = subRect ? subRect.width * 0.5 : 0;
      var searchHalfW = searchRect ? searchRect.width * 0.5 : 0;
      state.bodyHalfW = Math.max(subHalfW, searchHalfW, 290);
      state.bodyTop = state.wmBottom;
      if (factsRect && factsRect.height > 0) {
        state.bodyBottom = factsRect.bottom - heroCy;
      } else if (coreRect && coreRect.height > 0) {
        state.bodyBottom = coreRect.bottom - heroCy;
      } else {
        state.bodyBottom = 220;
      }

      if (canvas) {
        var nextW = Math.round(w * state.dpr);
        var nextH = Math.round(h * state.dpr);
        if (canvas.width !== nextW || canvas.height !== nextH) {
          canvas.width = nextW;
          canvas.height = nextH;
        }
      }

      if (state.isMobile) {
        clearMobileNodeStyles();
      } else if (state.isReduced) {
        layoutReducedDesktopNodes();
      }
      drawCanvas(state.canvasAngle);
    }

    /* --- Canvas 2D: anillos concéntricos, marcas radiales y brazos espirales --- */
    function drawCanvas(angleOffset) {
      if (!ctx || !canvas || !state.w || !state.h) return;
      var g = getGeometry();
      var p = state.palette;

      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      ctx.clearRect(0, 0, g.w, g.h);

      /* 8 anillos orbitales concéntricos con compresión elíptica suave */
      var ringCount = 8;
      var ringStart = g.minDim * 0.17;
      var ringEnd = g.diagR * 1.12;
      ctx.save();
      ctx.lineWidth = 1;
      for (var i = 0; i < ringCount; i++) {
        var frac = i / (ringCount - 1);
        var rx = ringStart + (ringEnd - ringStart) * frac;
        var ry = rx * g.ryScale;

        ctx.beginPath();
        ctx.ellipse(g.cx, g.cy, rx, ry, 0, 0, TAU);
        ctx.strokeStyle = p.border;
        ctx.globalAlpha = i % 2 === 0 ? 0.55 : 0.32;
        ctx.stroke();

        /* Marcas radiales sutiles girando lentamente en sentido antihorario */
        var tickCount = 16 + i * 4;
        var tickRot = -angleOffset * (0.55 + i * 0.08);
        var tickLen = i % 2 === 0 ? 7 : 5;
        ctx.beginPath();
        for (var t = 0; t < tickCount; t++) {
          var a = tickRot + (t / tickCount) * TAU;
          var cosA = Math.cos(a);
          var sinA = Math.sin(a);
          ctx.moveTo(g.cx + cosA * rx, g.cy + sinA * ry);
          ctx.lineTo(
            g.cx + cosA * (rx + tickLen),
            g.cy + sinA * (ry + tickLen * g.ryScale)
          );
        }
        ctx.strokeStyle = p.borderStrong;
        ctx.globalAlpha = 0.42;
        ctx.stroke();
      }
      ctx.restore();

      /* 6 arcos espirales luminosos saliendo hacia los bordes */
      if (!p.ribbons.length) return;
      var ribbonStart = g.minDim * 0.12;
      var ribbonEnd = g.diagR * 1.15;
      var segments = 18;
      var subSteps = 2;

      ctx.save();
      ctx.lineCap = 'round';
      for (var k = 0; k < p.ribbons.length; k++) {
        var baseTheta = (k / p.ribbons.length) * TAU - angleOffset * 1.2;
        var color = p.ribbons[k];
        ctx.strokeStyle = color;

        for (var s = 0; s < segments; s++) {
          var f0 = s / segments;
          var f1 = (s + 1) / segments;
          var fMid = (f0 + f1) * 0.5;
          var fade = Math.pow(Math.sin(Math.PI * fMid), 1.35);
          var alpha = fade * (p.isLight ? 0.52 : 0.72);
          if (alpha < 0.015) continue;

          ctx.globalAlpha = alpha;
          ctx.lineWidth = 1.1 + fMid * 1.1;
          ctx.beginPath();
          for (var sub = 0; sub <= subSteps; sub++) {
            var fracPoint = f0 + (f1 - f0) * (sub / subSteps);
            var r = ribbonStart + (ribbonEnd - ribbonStart) * Math.pow(fracPoint, 1.18);
            var th = baseTheta - fracPoint * 2.35;
            var px = g.cx + Math.cos(th) * r;
            var py = g.cy + Math.sin(th) * r * g.ryScale;
            if (sub === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    /* --- Móvil & prefers-reduced-motion --- */
    function clearMobileNodeStyles() {
      items.forEach(function (item) {
        var el = item.el;
        el.style.transform = '';
        el.style.opacity = '';
        el.style.zIndex = '';
        el.style.pointerEvents = '';
      });
    }

    function layoutReducedDesktopNodes() {
      var g = getGeometry();
      var ringR = Math.min(g.w * 0.42, g.h * 0.44);
      items.forEach(function (item, idx) {
        var angle = (idx / items.length) * TAU - Math.PI * 0.5;
        var x = Math.cos(angle) * ringR;
        var y = Math.sin(angle) * ringR * g.ryScale;
        item.el.style.transform =
          'translate3d(' + x.toFixed(1) + 'px, ' + y.toFixed(1) + 'px, 0) scale(1)';
        item.el.style.opacity = '1';
        item.el.style.zIndex = '7';
        item.el.style.pointerEvents = 'auto';
      });
    }

    /* --- Renderizado por cuadro de la espiral de profundidad --- */
    function renderNodes(now, dt) {
      if (state.isMobile || state.isReduced) return;
      var g = getGeometry();
      var halfW = g.w * 0.5;
      var halfH = g.h * 0.5;
      var reentryElapsed = state.reentryStart ? now - state.reentryStart : 99999;

      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (!item.frozen && dt > 0) {
          item.u += dt / CYCLE_S;
          if (item.u >= 1) {
            item.u %= 1;
            item.baseAngle += 0.35;
          }
        }

        var targetBoost = item.frozen ? 1.12 : 1;
        if (dt > 0) {
          item.hoverBoost += (targetBoost - item.hoverBoost) * Math.min(1, dt * 12);
        } else {
          item.hoverBoost = targetBoost;
        }

        var u = item.u;
        var r = g.rMin + (g.rMax - g.rMin) * Math.pow(u, 1.15);
        var theta = item.baseAngle - u * SPIRAL_SWEEP;
        var x = Math.cos(theta) * r;
        var y = Math.sin(theta) * r * g.ryScale;

        var growT = Math.min(1, u / 0.86);
        var baseScale = 0.36 + 0.78 * (1 - Math.pow(1 - growT, 3));
        var fadeIn = smoothstep(0.0, 0.28, u);
        var fadeOutCycle = 1 - smoothstep(0.88, 1.0, u);

        var edgeOutX = (Math.abs(x) - (halfW + 18)) / 64;
        var edgeOutY = (Math.abs(y) - (halfH + 18)) / 64;
        var edgeFade = 1 - smoothstep(0, 1, Math.max(edgeOutX, edgeOutY));

        /* Despeje en dos zonas: banda del wordmark y cuerpo inferior */
        var halfTile = 48 * baseScale + 10;
        var wmDist = Math.max(
          Math.abs(x) / Math.max(1, state.wmHalfW + halfTile),
          (y < state.wmTop - halfTile || y > state.wmBottom + halfTile)
            ? 1.25
            : Math.abs(y - (state.wmTop + state.wmBottom) * 0.5) /
              Math.max(1, (state.wmBottom - state.wmTop) * 0.5 + halfTile)
        );
        var bodyCy = (state.bodyTop + state.bodyBottom) * 0.5;
        var bodyHalfH = Math.max(1, (state.bodyBottom - state.bodyTop) * 0.5);
        var bodyDist = Math.max(
          Math.abs(x) / Math.max(1, state.bodyHalfW + halfTile),
          Math.abs(y - bodyCy) / Math.max(1, bodyHalfH + halfTile)
        );
        var coreDist = Math.min(wmDist, bodyDist);
        var insideCore = coreDist < 1.0;
        var corePresence = 0.36 + 0.64 * smoothstep(0.76, 1.08, coreDist);

        var reveal = 1;
        if (state.reentryStart) {
          reveal = smoothstep(
            0,
            1,
            (reentryElapsed - item.idx * REENTRY_STAGGER_MS) / REENTRY_DURATION_MS
          );
        }

        var scale = baseScale * item.hoverBoost * (0.86 + 0.14 * reveal);
        var opacity = fadeIn * fadeOutCycle * edgeFade * corePresence * reveal;

        var el = item.el;
        el.style.transform =
          'translate3d(' + x.toFixed(1) + 'px, ' + y.toFixed(1) + 'px, 0) scale(' + scale.toFixed(3) + ')';
        el.style.opacity = opacity.toFixed(3);

        if (item.frozen) {
          el.style.zIndex = '10';
          el.style.pointerEvents = 'auto';
        } else if (insideCore) {
          el.style.zIndex = '3';
          el.style.pointerEvents = 'none';
        } else {
          el.style.zIndex = '7';
          el.style.pointerEvents = opacity > 0.2 ? 'auto' : 'none';
        }
      }

      if (state.reentryStart && reentryElapsed > items.length * REENTRY_STAGGER_MS + REENTRY_DURATION_MS + 60) {
        state.reentryStart = 0;
      }
    }

    /* --- Bucle rAF controlado por visibilidad y ahorro energético --- */
    function tick(now) {
      state.rafId = 0;
      if (state.isMobile || state.isReduced || !state.isHeroVisible || document.hidden) {
        return;
      }

      var rawDt = state.lastTime ? (now - state.lastTime) / 1000 : 0.016;
      var dt = clamp(0, 0.05, rawDt);
      state.lastTime = now;

      state.canvasAngle = (state.canvasAngle + dt * RIBBON_ROT_SPEED) % TAU;
      drawCanvas(state.canvasAngle);
      renderNodes(now, dt);

      state.rafId = window.requestAnimationFrame(tick);
    }

    function updateLoop() {
      var shouldRun = !state.isMobile && !state.isReduced && state.isHeroVisible && !document.hidden;
      stage.classList.toggle('is-paused', !shouldRun);

      if (shouldRun) {
        if (!state.rafId) {
          state.lastTime = performance.now();
          state.rafId = window.requestAnimationFrame(tick);
        }
      } else if (state.rafId) {
        window.cancelAnimationFrame(state.rafId);
        state.rafId = 0;
      }
    }

    /* --- Interacción hover/focus en cada nodo (congela solo ese ícono) --- */
    items.forEach(function (item) {
      var el = item.el;
      el.addEventListener('pointerenter', function (e) {
        if (e.pointerType === 'touch' || state.isMobile) return;
        item.frozen = true;
      });
      el.addEventListener('pointerleave', function (e) {
        if (e.pointerType === 'touch') return;
        if (document.activeElement !== el) item.frozen = false;
      });
      el.addEventListener('focus', function () {
        if (!state.isMobile) item.frozen = true;
      });
      el.addEventListener('blur', function () {
        item.frozen = false;
      });
    });

    /* --- Observadores: viewport hero, tamaño, visibilidad y tema --- */
    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var visible = entry.isIntersecting;
          if (!visible) {
            state.hasLeftView = true;
          } else if (state.hasLeftView && !state.isMobile && !state.isReduced) {
            state.hasLeftView = false;
            state.reentryStart = performance.now();
          }
          state.isHeroVisible = visible;
          updateLoop();
        });
      }, { threshold: 0.05 });
      observer.observe(hero);
    }

    if (typeof window.ResizeObserver === 'function') {
      var ro = new ResizeObserver(function () {
        measure();
        if (!state.isMobile && !state.isReduced) renderNodes(performance.now(), 0);
        updateLoop();
      });
      ro.observe(hero);
      if (coreEl) ro.observe(coreEl);
      if (wordmarkEl) ro.observe(wordmarkEl);
    }

    if (typeof window.MutationObserver === 'function') {
      var themeObserver = new MutationObserver(function () {
        readThemeColors();
        drawCanvas(state.canvasAngle);
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme']
      });
    }

    if (reducedQuery && typeof reducedQuery.addEventListener === 'function') {
      reducedQuery.addEventListener('change', function (e) {
        state.isReduced = e.matches;
        measure();
        if (!state.isMobile && !state.isReduced) renderNodes(performance.now(), 0);
        updateLoop();
      });
    }

    window.addEventListener('resize', function () {
      measure();
      if (!state.isMobile && !state.isReduced) renderNodes(performance.now(), 0);
      updateLoop();
    }, { passive: true });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) state.lastTime = performance.now();
      updateLoop();
    });

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        measure();
        if (!state.isMobile && !state.isReduced) renderNodes(performance.now(), 0);
      }).catch(function () {});
    }

    readThemeColors();
    measure();
    if (!state.isMobile && !state.isReduced) {
      renderNodes(performance.now(), 0);
    }
    updateLoop();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVortex);
  } else {
    initVortex();
  }
})();
