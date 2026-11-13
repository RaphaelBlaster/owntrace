'use client';

import { motion, useMotionValue, useSpring, useTransform, AnimatePresence, useReducedMotion } from 'motion/react';
import { Children, cloneElement, useEffect, useMemo, useRef, useState } from 'react';

import './Dock.css';

function DockItem({ children, className = '', onClick, mouseX, spring, distance, magnification, baseItemSize, label, vertical, active }) {
  const ref = useRef(null);
  const isHovered = useMotionValue(0);

  const mouseDistance = useTransform(mouseX, val => {
    const rect = ref.current?.getBoundingClientRect() ?? {
      x: 0,
      y: 0,
      width: baseItemSize
    };
    return val - (vertical ? rect.y : rect.x) - baseItemSize / 2;
  });

  const targetSize = useTransform(
    mouseDistance,
    [-distance, 0, distance],
    [baseItemSize, magnification, baseItemSize]
  );
  const size = useSpring(targetSize, spring);

  return (
    <motion.button
      type="button"
      ref={ref}
      style={{
        width: size,
        height: size
      }}
      onHoverStart={() => isHovered.set(1)}
      onHoverEnd={() => isHovered.set(0)}
      onFocus={() => isHovered.set(1)}
      onBlur={() => isHovered.set(0)}
      onClick={onClick}
      className={`dock-item ${className}`}
      tabIndex={0}
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      >
      {Children.map(children, child => cloneElement(child, { isHovered }))}
    </motion.button>
  );
}

function DockLabel({ children, className = '', ...rest }) {
  const { isHovered } = rest;
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const unsubscribe = isHovered.on('change', latest => {
      setIsVisible(latest === 1);
    });
    return () => unsubscribe();
  }, [isHovered]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.span
          initial={{ opacity: 0, y: 0 }}
          animate={{ opacity: 1, y: -10 }}
          exit={{ opacity: 0, y: 0 }}
          transition={{ duration: 0.2 }}
          className={`dock-label ${className}`}
          role="tooltip"
          >
          {children}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function DockIcon({ children, className = '' }) {
  return <span className={`dock-icon ${className}`}>{children}</span>;
}

export default function Dock({
  items,
  className = '',
  spring = { mass: 0.1, stiffness: 150, damping: 12 },
  magnification = 70,
  distance = 200,
  panelHeight = 68,
  dockHeight = 256,
  baseItemSize = 50,
  orientation = 'horizontal',
  label = 'Application dock'
}) {
  const reduced = useReducedMotion();
  const vertical = orientation === 'vertical';
  const mouseX = useMotionValue(Infinity);
  const isHovered = useMotionValue(0);

  const maxHeight = useMemo(
    () => Math.max(dockHeight, magnification + magnification / 2 + 4),
    [magnification, dockHeight]
  );
  const heightRow = useTransform(isHovered, [0, 1], [panelHeight, maxHeight]);
  const height = useSpring(heightRow, spring);

  return (
    <motion.div style={vertical ? undefined : { height, scrollbarWidth: 'none' }} className={`dock-outer${vertical ? ' is-vertical' : ''}`}>
      <motion.div
        onMouseMove={({ clientX, clientY }) => {
          isHovered.set(1);
          mouseX.set(reduced ? Infinity : vertical ? clientY : clientX);
        }}
        onMouseLeave={() => {
          isHovered.set(0);
          mouseX.set(Infinity);
        }}
        className={`dock-panel ${className}`}
        style={vertical ? undefined : { height: panelHeight }}
        role="toolbar"
        aria-label={label}
        aria-orientation={orientation}
        onKeyDown={event => {
          const keys = vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
          if (![...keys, 'Home', 'End'].includes(event.key)) return;
          const buttons = Array.from(event.currentTarget.querySelectorAll('.dock-item'));
          const index = buttons.indexOf(document.activeElement);
          if (index < 0) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === keys[0] ? -1 : 1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }}>
        {items.map((item, index) => (
          <DockItem
            key={index}
            onClick={item.onClick}
            className={item.className}
            mouseX={mouseX}
            spring={spring}
            distance={distance}
            magnification={reduced ? baseItemSize : magnification}
            baseItemSize={baseItemSize}
            label={item.label}
            active={item.active}
            vertical={vertical}>
            <DockIcon>{item.icon}</DockIcon>
            <DockLabel>{item.label}</DockLabel>
          </DockItem>
        ))}
      </motion.div>
    </motion.div>
  );
}
