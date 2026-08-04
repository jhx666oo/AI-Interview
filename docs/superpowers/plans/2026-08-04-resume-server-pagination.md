# Resume Server Pagination Implementation Plan

**Goal:** Let resume management jump directly to any page, jump to the last page, and choose the page size while loading only the requested page from the server.

**Architecture:** Keep the existing `/api/resumes` `page`/`page_size` contract, move the list view from client-side slicing to server-side page requests, and use the API's `total` value for pagination. Filters remain in the request so page navigation preserves the current result set.

**Tech Stack:** React, TypeScript, Ant Design Pagination, Hono/Cloudflare D1.

## Tasks

1. Add a regression test for the paginated resume response contract and run it red.
2. Add a reusable pagination control with `showQuickJumper`, page-size options 20/50/100/200, and an explicit last-page action.
3. Update `Resumes/List.tsx` to request the active page and page size, reset to page one when filters change, and render the server total.
4. Update polling/reset paths so they preserve the active page and page size.
5. Run Worker tests, frontend build, and pre-deploy checks; inspect the final diff.
