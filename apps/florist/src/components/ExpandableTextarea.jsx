import { useRef, useEffect } from 'react';

export default function ExpandableTextarea({ defaultValue, onBlur, placeholder, disabled, className, minRows = 2 }) {
  const textRef = useRef(null);

  const adjustHeight = () => {
    if (textRef.current) {
      // Reset height first so it can shrink if text is deleted
      textRef.current.style.height = 'auto';
      textRef.current.style.height = `${textRef.current.scrollHeight}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [defaultValue]);

  return (
    <textarea
      ref={textRef}
      defaultValue={defaultValue}
      onBlur={onBlur}
      onInput={adjustHeight}
      placeholder={placeholder}
      disabled={disabled}
      rows={minRows}
      className={`${className} resize-none overflow-hidden`}
    />
  );
}
