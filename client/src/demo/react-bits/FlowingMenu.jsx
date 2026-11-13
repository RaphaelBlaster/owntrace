'use client';

import { useRef, useEffect, useState } from 'react';
import { gsap } from 'gsap';
import { Link } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';

import './FlowingMenu.css';

function FlowingMenu({
  items = [],
  speed = 15,
  textColor = '#fff',
  bgColor = '#120F17',
  marqueeBgColor = '#fff',
  marqueeTextColor = '#120F17',
  borderColor = '#fff',
  label = 'Explore workspace',
  onNavigate
}) {
  return (
    <div className="menu-wrap" style={{ backgroundColor: bgColor }}>
      <nav className="menu" aria-label={label}>
        {items.map((item, idx) => (
          <MenuItem
            key={idx}
            {...item}
            onNavigate={onNavigate}
            speed={speed}
            textColor={textColor}
            marqueeBgColor={marqueeBgColor}
            marqueeTextColor={marqueeTextColor}
            borderColor={borderColor} />
        ))}
      </nav>
    </div>
  );
}

function MenuItem({ link, text, image, preview, icon, badge, active, onNavigate, speed, textColor, marqueeBgColor, marqueeTextColor, borderColor }) {
  const reduced = useReducedMotion();
  const engaged = useRef(false);
  const itemRef = useRef(null);
  const marqueeRef = useRef(null);
  const marqueeInnerRef = useRef(null);
  const animationRef = useRef(null);
  const [repetitions, setRepetitions] = useState(4);

  const animationDefaults = { duration: 0.6, ease: 'expo' };

  const findClosestEdge = (mouseX, mouseY, width, height) => {
    const topEdgeDist = distMetric(mouseX, mouseY, width / 2, 0);
    const bottomEdgeDist = distMetric(mouseX, mouseY, width / 2, height);
    return topEdgeDist < bottomEdgeDist ? 'top' : 'bottom';
  };

  const distMetric = (x, y, x2, y2) => {
    const xDiff = x - x2;
    const yDiff = y - y2;
    return xDiff * xDiff + yDiff * yDiff;
  };

  useEffect(() => {
    const calculateRepetitions = () => {
      if (!marqueeInnerRef.current) return;

      // Get the first marquee part to measure content width
      const marqueeContent = marqueeInnerRef.current.querySelector('.marquee__part');
      if (!marqueeContent) return;

      const contentWidth = marqueeContent.offsetWidth;
      if (!contentWidth) return;
      const viewportWidth = window.innerWidth;

      // Calculate how many copies we need to fill viewport + extra for seamless loop
      // We need at least 2, but calculate based on content vs viewport
      const needed = Math.ceil(viewportWidth / contentWidth) + 2;
      setRepetitions(Math.max(4, needed));
    };

    calculateRepetitions();
    window.addEventListener('resize', calculateRepetitions);
    return () => window.removeEventListener('resize', calculateRepetitions);
  }, [text, image, preview]);

  useEffect(() => {
    const setupMarquee = () => {
      if (reduced) return;
      if (!marqueeInnerRef.current) return;

      const marqueeContent = marqueeInnerRef.current.querySelector('.marquee__part');
      if (!marqueeContent) return;

      const contentWidth = marqueeContent.offsetWidth;
      if (contentWidth === 0) return;

      if (animationRef.current) {
        animationRef.current.kill();
      }

      // Animate exactly one content width for seamless loop
      animationRef.current = gsap.to(marqueeInnerRef.current, {
        x: -contentWidth,
        duration: speed,
        ease: 'none',
        repeat: -1,
        paused: !engaged.current
      });
    };

    // Small delay to ensure DOM is ready after repetitions update
    const timer = setTimeout(setupMarquee, 50);

    return () => {
      clearTimeout(timer);
      if (animationRef.current) {
        animationRef.current.kill();
      }
    };
  }, [text, image, preview, repetitions, speed, reduced]);

  const handleMouseEnter = ev => {
    if (reduced) return;
    engaged.current = true;
    animationRef.current?.play();
    if (!itemRef.current || !marqueeRef.current || !marqueeInnerRef.current) return;
    const rect = itemRef.current.getBoundingClientRect();
    const x = Number.isFinite(ev.clientX) ? ev.clientX - rect.left : rect.width / 2;
    const y = Number.isFinite(ev.clientY) ? ev.clientY - rect.top : 0;
    const edge = findClosestEdge(x, y, rect.width, rect.height);

    gsap
      .timeline({ defaults: animationDefaults })
      .set(marqueeRef.current, { y: edge === 'top' ? '-101%' : '101%' }, 0)
      .set(marqueeInnerRef.current, { y: edge === 'top' ? '101%' : '-101%' }, 0)
      .to([marqueeRef.current, marqueeInnerRef.current], { y: '0%' }, 0);
  };

  const handleMouseLeave = ev => {
    if (reduced) return;
    engaged.current = false;
    animationRef.current?.pause();
    if (!itemRef.current || !marqueeRef.current || !marqueeInnerRef.current) return;
    const rect = itemRef.current.getBoundingClientRect();
    const x = Number.isFinite(ev.clientX) ? ev.clientX - rect.left : rect.width / 2;
    const y = Number.isFinite(ev.clientY) ? ev.clientY - rect.top : 0;
    const edge = findClosestEdge(x, y, rect.width, rect.height);

    gsap
      .timeline({ defaults: animationDefaults })
      .to(marqueeRef.current, { y: edge === 'top' ? '-101%' : '101%' }, 0)
      .to(marqueeInnerRef.current, { y: edge === 'top' ? '101%' : '-101%' }, 0);
  };

  return (
    <div className={`menu__item${active ? ' is-active' : ''}`} ref={itemRef} style={{ borderColor }}>
      <Link
        className="menu__item-link"
        to={link}
        aria-current={active ? 'page' : undefined}
        onClick={onNavigate}
        onFocus={handleMouseEnter}
        onBlur={handleMouseLeave}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{ color: textColor }}>
        {icon}<span>{text}</span>{badge ? <b>{badge}</b> : null}
      </Link>
      <div
        className="marquee"
        aria-hidden="true"
        ref={marqueeRef}
        style={{ backgroundColor: marqueeBgColor }}>
        <div className="marquee__inner-wrap">
          <div className="marquee__inner" ref={marqueeInnerRef} aria-hidden="true">
            {[...Array(repetitions)].map((_, idx) => (
              <div className="marquee__part" key={idx} style={{ color: marqueeTextColor }}>
                <span>{text}</span>{preview ? <small>{preview}</small> : null}
                {image ? <div className="marquee__img" style={{ backgroundImage: `url(${image})` }} /> : <i />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default FlowingMenu;
