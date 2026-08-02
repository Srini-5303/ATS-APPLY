<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	let open = $state(false);

	const links = [
		{ href: resolve('/'), label: 'Home' },
		{ href: resolve('/scanner'), label: 'Scanner' },
		{ href: resolve('/history'), label: 'History' }
	];

	const current = $derived(page.url.pathname);
</script>

<header class="bar">
	<a class="brand" href={resolve('/')}>
		<span class="mark" aria-hidden="true"></span>
		ATS Screener
	</a>

	<nav aria-label="Main">
		<button
			type="button"
			class="burger"
			aria-expanded={open}
			aria-controls="nav-links"
			onclick={() => {
				open = !open;
			}}
		>
			<span class="visually-hidden">{open ? 'Close menu' : 'Open menu'}</span>
			<span aria-hidden="true">{open ? '✕' : '☰'}</span>
		</button>

		<ul id="nav-links" class:open>
			{#each links as link (link.href)}
				<li>
					<a
						href={link.href}
						aria-current={current === link.href ? 'page' : undefined}
						onclick={() => {
							open = false;
						}}
					>
						{link.label}
					</a>
				</li>
			{/each}
		</ul>
	</nav>
</header>

<style>
	.bar {
		position: sticky;
		top: 0;
		z-index: 50;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-6);
		background: color-mix(in srgb, var(--color-bg-primary) 82%, transparent);
		backdrop-filter: blur(var(--glass-blur));
		border-bottom: 1px solid var(--glass-border);
	}

	.brand {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-weight: 600;
		color: var(--color-text-primary);
		text-decoration: none;
	}

	.mark {
		width: 18px;
		height: 18px;
		border-radius: var(--radius-sm);
		background: var(--gradient-primary);
	}

	ul {
		display: flex;
		gap: var(--space-5);
		list-style: none;
		padding: 0;
		margin: 0;
	}

	a {
		color: var(--color-text-secondary);
		text-decoration: none;
		font-size: var(--text-sm);
	}

	a:hover,
	a[aria-current='page'] {
		color: var(--color-text-primary);
	}

	a[aria-current='page'] {
		text-decoration: underline;
		text-underline-offset: 5px;
	}

	.burger {
		display: none;
		background: none;
		border: none;
		color: var(--color-text-primary);
		font-size: var(--text-lg);
		cursor: pointer;
	}

	@media (max-width: 640px) {
		.burger {
			display: block;
		}

		ul {
			position: absolute;
			top: 100%;
			right: var(--space-4);
			flex-direction: column;
			gap: var(--space-3);
			padding: var(--space-4) var(--space-6);
			background: var(--color-bg-secondary);
			border: 1px solid var(--glass-border);
			border-radius: var(--radius-md);
		}

		ul:not(.open) {
			display: none;
		}
	}
</style>
