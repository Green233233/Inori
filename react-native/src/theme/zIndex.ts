/** Fixed layer scale: never use arbitrary z-index values in UI code. */
export const Z = {
  content: 0,
  sticky: 10,
  dock: 12,
  sheetScrim: 20,
  sheet: 21,
  dialogScrim: 30,
  dialog: 31,
  toast: 40,
} as const;
