const nameInput = document.getElementById("name");
const wageInput = document.getElementById("wage");
const msg = document.getElementById("msg");
document.getElementById("save").addEventListener("click", () => {
  const data = { name: nameInput.value, wage: Number(wageInput.value) || 0 };
  localStorage.setItem("demo_user", JSON.stringify(data));
  msg.textContent = "保存しました（このPCのブラウザに保存）";
});
const saved = localStorage.getItem("demo_user");
if (saved) {
  const data = JSON.parse(saved);
  nameInput.value = data.name || "";
  wageInput.value = data.wage || "";
  msg.textContent = "前回の保存を読み込みました";
}

