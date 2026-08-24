import { getCurrentLanguage, translateText } from '../i18n'

export function sortByText<T>(items: T[], select: (item: T) => string) {
  const language=getCurrentLanguage()
  return [...items].sort((left, right) => translateText(select(left),language).localeCompare(translateText(select(right),language), language, { sensitivity: 'base', numeric: true }))
}
