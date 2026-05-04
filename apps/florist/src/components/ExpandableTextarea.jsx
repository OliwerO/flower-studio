import { useState, useRef, useEffect } from 'react';

export default function ExpandableTextarea({ defaultValue, onBlur, placeholder, disabled, className, minRows = 2 }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const textRef = useRef(null);

  const checkOverflow = () => {
    if (!textRef.current || expanded) return;
    const isOverflowing = textRef.current.scrollHeight > textRef.current.clientHeight;
    setOverflows(isOverflowing);
  };

  useEffect(() => {
    checkOverflow();
  }, [defaultValue, expanded]);

  const handleInput = (e) => {
    if (expanded) {
      e.target.style.height = 'auto';
      e.target.style.height = `${e.target.scrollHeight}px`;
    } else {
      checkOverflow();
    }
  };

  const expand = () => {
    if (!expanded) {
      setExpanded(true);
      if (textRef.current) {
        textRef.current.style.height = 'auto';
        textRef.current.style.height = `${textRef.current.scrollHeight}px`;
        textRef.current.focus();
      }
    }
  };

  return (
    <div className="relative">
      <textarea
        ref={textRef}
        defaultValue={defaultValue}
        onBlur={(e) => {
          setExpanded(false);
          if (textRef.current) textRef.current.style.height = ''; // revert to rows
          if (onBlur) onBlur(e);
        }}
        onFocus={expand}
        onInput={handleInput}
        placeholder={placeholder}
        disabled={disabled}
        rows={minRows}
        className={`${className} transition-all duration-200 ${expanded ? 'resize-none' : 'resize-none overflow-hidden'}`}
      />
      {!expanded && overflows && (
        <div 
          onClick={expand}
          className="absolute bottom-[2px] left-[2px] right-[2px] h-10 bg-gradient-to-t from-amber-50 dark:from-amber-900/30 to-transparent rounded-b-xl flex items-end justify-center pb-1.5 cursor-text"
        >
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700/80 dark:text-amber-300/80 bg-amber-100/90 dark:bg-amber-900/90 px-3 py-1 rounded-full shadow-sm backdrop-blur-sm active:scale-95 transition-transform">
            Tap to expand
          </span>
        </div>
      )}
    </div>
  );
}
