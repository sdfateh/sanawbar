app_name = "sanawbar"
app_title = "Sanawbar"
app_publisher = "Salah"
app_description = "Shared platform services, design system, and theme for Sanawbar apps"
app_email = "salahaldinfateh@gmail.com"
app_license = "mit"

required_apps = ["frappe"]

# The Desk skin is intentionally site-wide. Apps that require Sanawbar share
# the same Frappe theme without registering duplicate stylesheets. Other shared
# platform hooks and services can be added here as the product family grows.
app_include_css = "/assets/sanawbar/css/sanawbar_desk.css?v=20260901.2"
