import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["integrations/gnome-shell/**/*.js"],
    languageOptions: {
      globals: {
        global: "readonly"
      }
    }
  },
  {
    ignores: ["dist/**", "src-tauri/**", "node_modules/**"]
  }
);
