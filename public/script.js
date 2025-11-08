document.getElementById("split-btn").addEventListener("click", async () => {
  const file = document.getElementById("file").files[0];
  const parts = document.getElementById("parts").value;

  if (!file) return alert("画像を選択してください");

  const formData = new FormData();
  formData.append("image", file);
  formData.append("parts", parts);

  const res = await fetch("/api/split", { method: "POST", body: formData });
  const data = await res.json();

  const output = document.getElementById("output");
  output.innerHTML = "";
  data.parts.forEach(src => {
    const img = document.createElement("img");
    img.src = src;
    output.appendChild(img);
  });
});
