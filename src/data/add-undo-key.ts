// Where the undo of the last "Add items from a file" (F33) is kept. Its own module so a restore or a
// fresh setup can forget it without loading the file reader (review R8, M33).
export const ADD_UNDO_KEY = 'addItemsUndo';
