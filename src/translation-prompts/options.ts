/**
 * Get all available language options for UI selection
 */
export function getAvailableLanguageOptions(): Array<{ value: string; label: string; nativeName: string }> {
  return [
    { value: 'english', label: 'English', nativeName: 'English' },
    { value: 'japanese', label: 'Japanese', nativeName: '日本語' },
    { value: 'vietnamese', label: 'Vietnamese', nativeName: 'Tiếng Việt' }
  ];
}

/**
 * Get language display name (native name with English label)
 */
export function getLanguageDisplayName(languageCode: string): string {
  const options = getAvailableLanguageOptions();
  const option = options.find(opt => opt.value === languageCode);
  return option ? `${option.nativeName} (${option.label})` : languageCode;
}
