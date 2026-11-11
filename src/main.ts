import "./styles/app.css";

console.log("Deskumi engine initialized");

const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  app.innerHTML = `
    <div style="display:flex; justify-content:center; align-items:center; height:100%; color: #333; font-family: sans-serif;">
      <h1>Deskumi Engine</h1>
    </div>
  `;
}
