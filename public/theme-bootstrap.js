try {
  const theme = localStorage.getItem("headershim.theme");
  if (theme === "light" || theme === "dark") {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
} catch {
  document.documentElement.removeAttribute("data-theme");
}
