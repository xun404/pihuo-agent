/**
 * Bundled OpenChamber theme sources.
 *
 * The JSON files are the source of truth for metadata and colors.  Keep this
 * list as imports only; normalization and the desktop token mapping live in
 * ../theme.config.ts so adding a theme never requires copying a color map.
 */
import auraDark from './aura-dark.json'
import auraLight from './aura-light.json'
import ayuDark from './ayu-dark.json'
import ayuLight from './ayu-light.json'
import carbonfoxDark from './carbonfox-dark.json'
import carbonfoxLight from './carbonfox-light.json'
import catppuccinDark from './catppuccin-dark.json'
import catppuccinLight from './catppuccin-light.json'
import draculaDark from './dracula-dark.json'
import draculaLight from './dracula-light.json'
import fieldsOfTheShireDark from './fields-of-the-shire-dark.json'
import fieldsOfTheShireLight from './fields-of-the-shire-light.json'
import flexokiDark from './flexoki-dark.json'
import flexokiLight from './flexoki-light.json'
import gruvboxDark from './gruvbox-dark.json'
import gruvboxLight from './gruvbox-light.json'
import jetbrainsDark from './jetbrains-dark.json'
import jetbrainsLight from './jetbrains-light.json'
import kanagawaDark from './kanagawa-dark.json'
import kanagawaLight from './kanagawa-light.json'
import monoDark from './mono-dark.json'
import monoLight from './mono-light.json'
import monoPlusDark from './mono-plus-dark.json'
import monoPlusLight from './mono-plus-light.json'
import monokaiDark from './monokai-dark.json'
import monokaiLight from './monokai-light.json'
import nightowlDark from './nightowl-dark.json'
import nightowlLight from './nightowl-light.json'
import nordDark from './nord-dark.json'
import nordLight from './nord-light.json'
import onedarkproDark from './onedarkpro-dark.json'
import onedarkproLight from './onedarkpro-light.json'
import openchamberDark from './openchamber-dark.json'
import openchamberLight from './openchamber-light.json'
import solarizedDark from './solarized-dark.json'
import solarizedLight from './solarized-light.json'
import tokyonightDark from './tokyonight-dark.json'
import tokyonightLight from './tokyonight-light.json'
import vesperDark from './vesper-dark.json'
import vesperLight from './vesper-light.json'
import vitesseDark from './vitesse-dark-dark.json'
import vitesseLight from './vitesse-light-light.json'

/** All bundled JSON sources, kept as raw data until shared normalization. */
export const bundledThemeJson = [
  auraDark,
  auraLight,
  ayuDark,
  ayuLight,
  carbonfoxDark,
  carbonfoxLight,
  catppuccinDark,
  catppuccinLight,
  draculaDark,
  draculaLight,
  fieldsOfTheShireDark,
  fieldsOfTheShireLight,
  flexokiDark,
  flexokiLight,
  gruvboxDark,
  gruvboxLight,
  jetbrainsDark,
  jetbrainsLight,
  kanagawaDark,
  kanagawaLight,
  monoDark,
  monoLight,
  monoPlusDark,
  monoPlusLight,
  monokaiDark,
  monokaiLight,
  nightowlDark,
  nightowlLight,
  nordDark,
  nordLight,
  onedarkproDark,
  onedarkproLight,
  openchamberDark,
  openchamberLight,
  solarizedDark,
  solarizedLight,
  tokyonightDark,
  tokyonightLight,
  vesperDark,
  vesperLight,
  vitesseDark,
  vitesseLight,
] as const
