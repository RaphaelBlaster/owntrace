# React Bits components

Source: [DavidHDev/react-bits](https://github.com/DavidHDev/react-bits), the official [React Bits](https://reactbits.dev) registry.

Installed on 2026-10-01 from the client directory:

```powershell
npx.cmd shadcn@latest add @react-bits/SpotlightCard-JS-CSS @react-bits/CountUp-JS-CSS @react-bits/AnimatedContent-JS-CSS --yes --path src/demo/react-bits
npx.cmd shadcn@latest add @react-bits/Dock-JS-CSS @react-bits/TechText-JS-CSS @react-bits/FlowingMenu-JS-CSS @react-bits/StatusMark-JS-CSS --yes --path src/demo/react-bits
```

These are vendored JavaScript/CSS registry sources. `package-lock.json` records the installed Motion and GSAP dependencies. The upstream MIT + Commons Clause license is retained in [LICENSE.md](./LICENSE.md).

Local adaptations:

- CountUp accepts an optional `decimals` prop so dollar amounts retain two decimal places.
- `../BitsSurface.jsx` disables entrance/count animations when reduced motion is requested and gives metric values stable accessible labels.
- `../prism-bits.css` applies OwnTrace's slate, cyan, and lime design tokens to SpotlightCard surfaces.
- Dock supports a vertical orientation, native buttons, active-page semantics, arrow/Home/End navigation, and reduced motion. Pointer coordinates use the same viewport coordinate system as element bounds. The initial vertical bounds include y=0, so icons have their intended size before any pointer movement.
- FlowingMenu uses router links, optional icons/counts/preview copy, keyboard focus feedback, and namespaced CSS. Decorative content is hidden from assistive technology. Its marquee runs only on engagement, with no marquee under reduced motion.
- TechText renders the compact wordmark without idle sweep or draggable letters. The app uses real text under reduced motion.
- StatusMark supplies scan and review lifecycle feedback; persistent labels disable strike-through. `../navigation.css` supplies product styling and mobile/reduced-motion overrides.

The footprint explorer, keyboard search, and review flows are OwnTrace application code. All account and provider interactions in `/demo` use sample data.
