import globals from 'globals';
export default [{
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'script',
    globals: {
      ...globals.browser,
      ...globals.greasemonkey,
      unsafeWindow: 'readonly',
      GM_info: 'readonly',
      GM_xmlhttpRequest: 'readonly',
      GM_getValue: 'readonly',
      GM_setValue: 'readonly',
      GM_deleteValue: 'readonly',
      GM_listValues: 'readonly',
      GM_setClipboard: 'readonly',
      GM_registerMenuCommand: 'readonly',
      GM_notification: 'readonly',
      GM_getResourceText: 'readonly',
      GM_addStyle: 'readonly',
      GM_openInTab: 'readonly',
      FUSION: 'writable',
      JSZip: 'readonly',
      Hls: 'readonly'
    }
  },
  rules: {
    'no-undef': 'error',
    'no-dupe-keys': 'error',
    'no-dupe-args': 'error',
    'no-unreachable': 'error',
    'no-cond-assign': 'error',
    'no-self-assign': 'error',
    'no-constant-condition': 'error'
  }
}];
