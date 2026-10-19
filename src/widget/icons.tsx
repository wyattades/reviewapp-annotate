const stroke = {
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 2,
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": true,
} as const;

export const CommentIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...stroke} stroke-width={2.25}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

export const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="10" height="10" {...stroke}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const CheckCircleIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...stroke}>
    <circle cx="12" cy="12" r="10" />
    <path d="m8 12 3 3 5-6" />
  </svg>
);

export const MoreIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="currentColor"
    aria-hidden="true"
  >
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
);

export const SendIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...stroke}>
    <path d="m22 2-7 20-4-9-9-4zM22 2 11 13" />
  </svg>
);
