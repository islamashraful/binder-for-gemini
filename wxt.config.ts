import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Binder for Gemini – Chat Folders',
    short_name: 'Binder',
    description:
      'Organize your Gemini chats into folders, right in the sidebar. Not affiliated with Google.',
    permissions: ['storage'],
  },
});
