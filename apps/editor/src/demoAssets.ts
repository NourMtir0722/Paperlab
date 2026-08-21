import type { ContentConfigInput } from 'paperlab'

/**
 * What fills an empty slot in the Field composer.
 *
 * This used to be eight HSL gradient tiles with a translucent white disc on
 * each — generated locally, which was the right instinct (offline, no rate
 * limit, nothing to leak into an export) attached to the wrong art
 * direction. A library about PAPER greeted every visitor who clicked
 * **Field** with a carousel of app-icon swatches, and that screenshot did
 * more damage than any missing feature.
 *
 * The technique is unchanged; only what it draws is different. These are
 * paper artifacts — the small printed things paper actually gets cut into —
 * so the default field reads as a drawer of records rather than a colour
 * picker. They are `card` content rather than images, which means they are
 * not photographs OF paper: they are typeset by the same painter that sets
 * every other sheet, on the slot's own stock, and they curl with the mesh.
 *
 * PREVIEW-only, exactly as before: this pool never reaches an export.
 * See App.tsx `fieldExportInput`.
 */
export const DEMO_CARDS: ContentConfigInput[] = [
  {
    type: 'card',
    title: 'Specimen',
    body: 'Wove, 120gsm.\nDeckle on two edges.',
    note: 'Mill no. 14 · 1954',
    ruled: false,
  },
  {
    type: 'card',
    title: 'Return by',
    body: '12 MAR\n19 MAR\n2 APR',
    note: 'Fines accrue daily',
    ruled: true,
  },
  {
    type: 'card',
    title: 'Telegram',
    body: 'ARRIVED SAFELY STOP\nPAPER HOLDS STOP',
    note: 'Received 04:12',
    ruled: false,
  },
  {
    type: 'card',
    title: 'Catalogue',
    body: 'Study of a folded sheet',
    note: 'Graphite on card, 1971',
    ruled: false,
  },
  {
    type: 'card',
    title: 'Index',
    body: 'Everything that can be\nfolded remembers it.',
    note: 'card 07 of 40',
    ruled: true,
  },
  {
    type: 'card',
    title: 'Admit one',
    body: 'ROW G\nSEAT 14',
    note: 'No re-entry',
    ruled: false,
    align: 'center',
  },
  {
    type: 'card',
    title: 'Note to self',
    body: 'Buy more paper.\nThe good kind.',
    note: '',
    ruled: true,
  },
  {
    type: 'card',
    title: 'Label',
    body: 'Handle at the edges',
    note: 'Archive box 3',
    ruled: false,
    align: 'center',
  },
]
