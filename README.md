# point-guesser

This small web app is a 3D "paraboloid point guesser" — inspired by GeoGuessr style gameplay.

How it works:
- A randomized quadratic surface (paraboloid-like) is generated using a random equation z = f(x,y).
- A target x and y are shown to you; you must compute the correct z value from the equation.
- Enter the x, y, z into the input boxes and press "Submit Guess".
- The app plots both the true point and your guessed point on the textured paraboloid and shows how close you were.

Files:
- `index.html` — the app UI and entry point.
- `styles.css` — simple styles for layout and theme.
- `main.js` — the Three.js scene, paraboloid generation, and game logic.

To run:
Open `index.html` in a modern browser (Chrome/Edge/Firefox). It uses a CDN copy of Three.js and an online Earth texture.

Notes:
- The paraboloid uses a cylindrical UV projection to apply an Earth texture. This gives a GeoGuessr feel but is an artistic mapping.
- If you want a packaged/static version, you can host these files on any static server.

Have fun!

# point-guesser