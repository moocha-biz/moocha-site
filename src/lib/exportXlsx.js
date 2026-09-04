// Dynamically imported — xlsx is a large library and only admin export
// clicks ever need it, so this keeps it out of the bundle every customer
// downloads just to browse the menu.
export async function exportToExcel(filename, sheets) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}
