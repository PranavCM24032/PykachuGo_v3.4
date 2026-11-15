import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { playSound } from '../services/audio';
import type { MissionGroup, SelectOption } from '../types/game';

interface CustomSelectProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options?: SelectOption[];
  groups?: MissionGroup[];
  placeholder?: string;
  playClick?: boolean;
  darkBackdrop?: boolean;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  id,
  value,
  onChange,
  options = [],
  groups = [],
  placeholder = 'Select...',
  playClick = true,
}) => {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const flatOptions = useMemo(() => {
    const list: SelectOption[] = [...options];
    groups.forEach((g) => {
      g.missions.forEach((m) => list.push(m));
    });
    return list;
  }, [options, groups]);

  const selectedOption = useMemo(
    () => flatOptions.find((o) => o.value === value) || flatOptions[0] || null,
    [flatOptions, value]
  );

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const btn = btnRef.current;
      const menu = menuRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const maxH = 256;
      const menuRaw = menu ? menu.scrollHeight || maxH : maxH;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const openUp = spaceBelow < Math.min(maxH, menuRaw) + 8 && spaceAbove > spaceBelow;
      const cap = openUp
        ? Math.max(96, Math.min(maxH, spaceAbove - 8))
        : Math.max(96, Math.min(maxH, spaceBelow - 8));

      setMenuStyle({
        position: 'fixed',
        width: `${rect.width}px`,
        left: `${rect.left}px`,
        zIndex: 99999,
        maxHeight: `${cap}px`,
        ...(openUp
          ? { top: 'auto', bottom: `${window.innerHeight - rect.top + 6}px` }
          : { top: `${rect.bottom + 6}px`, bottom: 'auto' }),
      });
    };

    updatePosition();
    const raf = requestAnimationFrame(updatePosition);

    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (
        wrapRef.current &&
        !wrapRef.current.contains(target) &&
        menuRef.current &&
        !menuRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };

    const onScroll = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target && menuRef.current && (target === menuRef.current || menuRef.current.contains(target))) {
        return;
      }
      setOpen(false);
    };

    const onResize = () => setOpen(false);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };

    document.addEventListener('click', onDocClick);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('click', onDocClick);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (playClick) playSound('click');
    setOpen((prev) => !prev);
  };

  const handleSelect = (optValue: string) => {
    if (playClick) playSound('click');
    onChange(optValue);
    setOpen(false);
  };

  const renderIcon = (icon?: string) => {
    if (!icon) return null;
    const src = icon.startsWith('/') ? icon : `/${icon}`;
    return (
      <img
        src={src}
        alt=""
        className="w-4 h-4 sm:w-5 sm:h-5 shrink-0 object-contain inline-block pointer-events-none select-none"
      />
    );
  };

  const getGroupLabelClass = (group: MissionGroup) => {
    const labelUpper = (group.label || '').toUpperCase();
    if (labelUpper.includes('LEVEL 2')) return 'text-yellow-500';
    if (labelUpper.includes('LEVEL 3')) return 'text-red-500';
    return 'text-blue-400';
  };

  return (
    <div ref={wrapRef} className="relative w-full custom-select custom-select-host" id={`${id}Wrapper`}>
      <button
        ref={btnRef}
        id={id}
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={handleToggle}
        className="w-full bg-black/40 border border-slate-800 rounded-lg pl-2 pr-2 sm:pl-3 sm:pr-3 py-1.5 sm:py-2 text-white text-left flex items-center justify-between gap-2 hover:border-blue-500/50 focus:border-blue-500 focus:outline-none transition-all cursor-pointer text-[11px] sm:text-xs"
      >
        <span className="flex items-center gap-1.5 sm:gap-2 min-w-0">
          {renderIcon(selectedOption?.icon)}
          <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
        </span>
        <span className="material-symbols-rounded text-gray-500 text-base sm:text-lg shrink-0 pointer-events-none">
          {open ? 'expand_less' : 'expand_more'}
        </span>
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={menuStyle}
            className="z-50 w-full overflow-y-auto bg-[#0a0f1d] border border-slate-800 rounded-lg shadow-2xl custom-select-menu"
          >
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={opt.value === value}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelect(opt.value);
                }}
                className="w-full text-left px-2 sm:px-3 py-1.5 sm:py-2 text-gray-300 hover:bg-blue-500/10 hover:text-white flex items-center gap-1.5 sm:gap-2 transition-colors cursor-pointer text-[11px] sm:text-xs"
              >
                {renderIcon(opt.icon)}
                <span className="truncate">{opt.label}</span>
              </button>
            ))}

            {groups.map((group) => (
              <React.Fragment key={group.level}>
                <div
                  className={`px-2 sm:px-3 pt-1.5 pb-0.5 text-[9px] sm:text-[10px] uppercase tracking-widest font-bold pointer-events-none select-none ${getGroupLabelClass(group)}`}
                >
                  {(group.label || '').replace(/:\s*$/, '')}
                </div>
                {group.missions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={opt.value === value}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelect(opt.value);
                    }}
                    className="w-full text-left px-2 sm:px-3 py-1.5 sm:py-2 text-gray-300 hover:bg-blue-500/10 hover:text-white flex items-center gap-1.5 sm:gap-2 transition-colors cursor-pointer text-[11px] sm:text-xs"
                  >
                    {renderIcon(opt.icon)}
                    <span className="truncate">{opt.label}</span>
                  </button>
                ))}
              </React.Fragment>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
};
