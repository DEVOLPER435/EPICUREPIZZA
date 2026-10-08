# Epicure Pizza

Responsive restaurant ordering website with a customer account area and role-protected staff dashboard. The frontend is plain HTML, CSS and JavaScript; Supabase provides authentication, PostgreSQL, row-level security and order processing.

## Features

- Customer account creation, sign-in and sign-out.
- Live menu, categories, search and item availability.
- Shopping cart saved in the browser.
- Pickup and delivery order form, with orders saved to the database.
- Customer order history and order status.
- Staff dashboard for orders, status changes, and menu management.
- Staff can change the delivery fee in the restaurant settings section.
- Super-admin role management for customer/admin/super-admin accounts.
- Server-side price calculation in a PostgreSQL function; browser prices are not trusted.
- Row-level security on customer profiles, products, orders and order items.
- Responsive animated 3D-style design and reduced-motion support.

## Required setup

1. Create a Supabase project.
2. Open the Supabase SQL Editor and run `supabase.sql`.
3. Register your own account using the website. Confirm the email if email confirmation is enabled.
4. In Supabase Authentication → Users, copy your user UUID. Uncomment the final `UPDATE` statement in the SQL file, replace the placeholder UUID, and run it once to grant yourself `super_admin`.
5. Copy the Supabase Project URL and anon/public key into `config.js`. **Never use a `service_role` key in browser code.**
6. Update the restaurant currency, locale, address, phone and opening hours in `config.js`. Replace the seeded sample menu in `supabase.sql` with the client's actual menu/prices before running the seed section. The owner can set the delivery fee later from the admin dashboard.
7. Serve the folder locally with any static web server (for example `python -m http.server 8000`) and open `http://localhost:8000`.

## Deploy

Keep the source in GitHub, then deploy the folder as a static site through a host whose terms permit commercial restaurant websites. GitHub Pages is not suitable for hosting an online business or transactional restaurant site under its current usage policy. Add the production domain to Supabase Authentication → URL Configuration and configure the allowed redirect URLs.

This project takes **cash/in-person payment** at pickup or delivery. Card processing, delivery maps, SMS notifications, tax rules and live courier tracking require the restaurant's chosen providers and configuration.

## Security notes

- The browser uses only the Supabase project URL and public anon key. Database access is restricted by RLS.
- The SQL `create_order` function recalculates prices from the database and only creates an order for the signed-in user.
- New accounts are always created with the `customer` role. Only an existing super-admin can change roles through `set_user_role`.
- Keep Supabase email confirmation enabled for customer accounts and use a strong password for the owner super-admin account.
