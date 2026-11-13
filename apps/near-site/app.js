/* NEAR HACKATHON work (2026-11-14). Minimal, dependency-free page behaviour. */
(function () {
  'use strict';
  var doc = document.documentElement;
  doc.classList.add('js');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Scroll progress
  var bar = document.querySelector('.scroll-progress');
  function onScroll() {
    var max = doc.scrollHeight - window.innerHeight;
    if (bar) bar.style.transform = 'scaleX(' + (max > 0 ? window.scrollY / max : 0) + ')';
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Mobile menu
  var toggle = document.querySelector('.menu-toggle');
  var mnav = document.getElementById('mobile-nav');
  function setMenu(open) {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    mnav.hidden = !open;
  }
  if (toggle && mnav) {
    toggle.addEventListener('click', function () { setMenu(mnav.hidden); });
    mnav.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !mnav.hidden) { setMenu(false); toggle.focus(); } });
  }

  // Nav highlight
  var links = Array.prototype.slice.call(document.querySelectorAll('.desktop-nav a[href^="#"]'));
  var map = {};
  links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
  // Sections without their own nav item highlight the nearest related item.
  var alias = { witness: 'how', cafe: 'ai-pass', screens: 'mini', built: 'mini' };
  if ('IntersectionObserver' in window) {
    var navObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var id = alias[en.target.id] || en.target.id;
        links.forEach(function (a) { a.classList.remove('active'); a.removeAttribute('aria-current'); });
        if (map[id]) { map[id].classList.add('active'); map[id].setAttribute('aria-current', 'true'); }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    document.querySelectorAll('main section[id]').forEach(function (s) { navObs.observe(s); });

    // Reveal on scroll
    if (!reduce) {
      var revObs = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); revObs.unobserve(en.target); } });
      }, { rootMargin: '0px 0px -8% 0px' });
      document.querySelectorAll('.reveal').forEach(function (el) { revObs.observe(el); });
    } else {
      document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('in'); });
    }
  } else {
    document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('in'); });
  }

  // Hero video: muted autoplay loop unless reduced motion; play/pause + unmute toggles
  var video = document.getElementById('hero-video');
  var playBtn = document.querySelector('.ctl-play');
  var soundBtn = document.querySelector('.ctl-sound');
  function syncPlay() {
    var playing = !video.paused;
    playBtn.setAttribute('aria-pressed', String(playing));
    playBtn.setAttribute('aria-label', playing ? 'Pause video' : 'Play video');
    playBtn.querySelector('.ctl-label').textContent = playing ? 'Pause' : 'Play';
  }
  function syncSound() {
    var on = !video.muted;
    soundBtn.setAttribute('aria-pressed', String(on));
    soundBtn.setAttribute('aria-label', on ? 'Mute video' : 'Unmute video');
    soundBtn.querySelector('.ctl-label').textContent = on ? 'Sound on' : 'Sound off';
  }
  if (video && playBtn && soundBtn) {
    video.muted = true;
    if (!reduce) {
      video.autoplay = true;
      var p = video.play();
      if (p && p.catch) p.catch(function () {});
    }
    video.addEventListener('play', syncPlay);
    video.addEventListener('pause', syncPlay);
    video.addEventListener('volumechange', syncSound);
    playBtn.addEventListener('click', function () {
      if (video.paused) { var q = video.play(); if (q && q.catch) q.catch(function () {}); } else { video.pause(); }
    });
    soundBtn.addEventListener('click', function () {
      video.muted = !video.muted;
      if (!video.muted && video.paused) { var q = video.play(); if (q && q.catch) q.catch(function () {}); }
    });
    syncPlay(); syncSound();
  }

  // Screen lightbox
  var dlg = document.querySelector('.lightbox');
  if (dlg && typeof dlg.showModal === 'function') {
    var img = dlg.querySelector('.lightbox-img');
    var cap = dlg.querySelector('.lightbox-caption');
    var opener = null;
    document.querySelectorAll('.shot').forEach(function (btn) {
      btn.addEventListener('click', function () {
        opener = btn;
        img.src = btn.getAttribute('data-full');
        img.alt = btn.querySelector('img').alt;
        cap.textContent = btn.getAttribute('data-caption');
        dlg.showModal();
      });
    });
    dlg.querySelector('.lightbox-close').addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', function () { if (opener) opener.focus(); });
  }
})();
