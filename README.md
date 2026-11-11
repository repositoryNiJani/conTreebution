ConTreebution

ConTreebution turns GitHub contributions into a customizable 3D tree. Choose a tree species, season, leaf color, and viewing options, then share the result or embed it in a portfolio.

---

Project structure

```text
contreebution/
├── api/
│   └── contributions.js  Optional serverless GitHub GraphQL endpoint
├── app.js                Three.js scene, contribution data, and UI behavior
├── index.html            Main app markup and import map
├── portfolio.html        Example portfolio with an embedded tree
├── styles.css            App styles, layout, and animations
└── README.md             Setup, usage, and embed guide
```

Three.js and its add-ons are loaded from jsDelivr using the import map in `index.html`.

---

Run locally

1. Start a local web server from the project directory. For a simple static preview with Python:

   ```sh
   python -m http.server 8000
   ```

   Alternatively, on Windows:

   ```powershell
   py -m http.server 8000
   ```

2. Open `http://localhost:8000/` to use the app.
3. Open `http://localhost:8000/portfolio.html` to see the portfolio embed sample.

The static server is enough to preview sample trees. GitHub profile lookups use the public fallback API if the optional `/api/contributions` endpoint is not deployed.

---

Use the app

1. Enter a GitHub username. The contribution range defaults to **All time**; select **Last 12 months** if you prefer.
2. Select a season, tree type, tree style, leaf shape, and leaf color.
3. Adjust the view and other available controls.
4. Use **Link to your tree** to share a URL with the current settings.
5. Use **Embed in your portfolio** to copy iframe markup for the current tree.

When a GitHub profile is loaded, the preview number controls are disabled so visitors cannot change the profile's contribution count. Sample trees remain adjustable.

---

Embed a tree

1. Open ConTreebution on its hosted site.
2. Load a GitHub profile and choose the tree settings you want to show.
3. Copy the generated code from **Embed in your portfolio**.
4. Paste the iframe where you want the tree to appear on your site.

The generated embed URL includes `embed=1`, which hides the app header and settings so only the tree is shown. When contribution calendar data is available, a small calendar icon appears over the tree; visitors can click it to show or hide the calendar. It stays hidden by default. You can also create a link manually:

```html
<iframe
  src="https://YOUR-DOMAIN/?u=YOUR_GITHUB_USERNAME&amp;embed=1&amp;type=sakura&amp;season=spring"
  width="100%"
  height="480"
  style="border:0"
  title="My GitHub contribution tree"
  loading="lazy"
>
</iframe>
```

Replace `YOUR-DOMAIN` with the deployed ConTreebution site and `YOUR_GITHUB_USERNAME` with the GitHub account to display. Use the app's generated embed code to include all selected settings, including a custom leaf color.

For a fixed sample tree instead of a GitHub profile, use a contribution count:

```html
<iframe
  src="https://YOUR-DOMAIN/?n=419&amp;embed=1&amp;type=sakura"
  width="100%"
  height="480"
  style="border:0"
  title="Sample contribution tree"
  loading="lazy"
>
</iframe>
```

---

GitHub contribution API (optional)

The project includes a Vercel/Netlify-style serverless function at `api/contributions.js`. Deploy the project to a platform that supports this function format and set the `GITHUB_TOKEN` environment variable in the hosting dashboard. The token needs no additional scopes for public contribution data and must remain server-side; never add it to the HTML or JavaScript files.

The app tries this endpoint first, then falls back to the public community contributions API. Without either API available, it can still display sample trees.

-repositoryniJani
