export function filesToImageEntries(files) {
  return [...files]
    .filter((file) => /^image\/(png|jpe?g|webp)$/i.test(file.type))
    .map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
      name: file.name,
      type: file.type,
      size: file.size,
      file,
      url: URL.createObjectURL(file),
      source: 'upload',
    }));
}

export function revokeImageEntryUrls(entries) {
  entries.forEach((entry) => {
    if (entry.source === 'upload' && entry.url) URL.revokeObjectURL(entry.url);
  });
}
