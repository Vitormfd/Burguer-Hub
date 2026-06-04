# Instruções Técnicas - Landing Page Burguer Hub com Parallax

## Bibliotecas Recomendadas

1. **Framer Motion** - Animações smoothas e parallax
2. **AOS (Animate On Scroll)** - Detecção de scroll e animações
3. **React Intersection Observer** - Para triggers de animação ao entrar viewport
4. **Lottie React** - Para ícones animados

## Implementação Técnica do Parallax

### 1. Hero Section Parallax
```
- Usar background-attachment: fixed para efeito parallax CSS puro
- OU usar Framer Motion com useScroll e useTransform para parallax JavaScript
- Velocidade da imagem: ~0.3x (30% da velocidade do scroll)
- Overlay gradiente: rgba(0,0,0,0.3) até rgba(255, 107, 53, 0.2) (laranja)
```

### 2. Cards com Scroll Animation
```
- Cada card tem opacity: 0 inicialmente
- Quando entra no viewport (Intersection Observer ou AOS):
  - Fade-in: opacity 0 → 1 (400ms)
  - Slide-in: translateX variável
    * Coluna 1: -50px (entra da esquerda)
    * Coluna 2: 0px (entra do centro com scale)
    * Coluna 3: +50px (entra da direita)
  - Scale: 0.9 → 1.0 (crescer ligeiramente)
- Delay escalonado entre cards (100ms cada)
```

### 3. Elementos Decorativos Flutuantes (Parallax)
```
Exemplo: Hambúrgueres, moedas, talheres no fundo do hero

- Posicionar com position: absolute no container do hero
- Usar Framer Motion para calcular posição baseado no scroll
- Fórmula: translateY = scrollY * velocidade (diferentes velocidades)
  * Elemento 1: velocidade 0.2
  * Elemento 2: velocidade 0.5
  * Elemento 3: velocidade 0.8
- Overflow: hidden no container pai
- Adicionar slight rotation ao elemento (15-30 graus)
```

### 4. Counters Animados
```
- Usar useEffect + useState
- Ao entrar no viewport:
  - Iniciar animação de número de 0 até target
  - Duração: 1.5s (1500ms)
  - Usar requestAnimationFrame para smooth
- Exemplo:
  * "+500 Hamburguerias" → conta de 0 a 500
  * "+2M Pedidos" → conta de 0 a 2,000,000
```

## Estrutura de Componentes

```
<LandingPage>
  ├── <Header> (sticky, menu fixo)
  ├── <HeroSection> (com parallax background + flutuantes)
  ├── <ProblemasSolucoes> (cards com scroll animation)
  ├── <Funcionalidades> (6 cards, parallax individual)
  ├── <ComoFunciona> (3 steps com imagens em parallax)
  ├── <Recursos> (lista com checkmarks + animação)
  ├── <Tecnologias> (logos com hover effect)
  ├── <Planos> (pricing cards com hover)
  ├── <Depoimentos> (carousel com parallax)
  ├── <FAQ> (accordion com smooth open/close)
  ├── <CTAFinal> (call to action com animação pulsante)
  └── <Footer>
```

## Efeitos Específicos de Scroll

### Ao descer a página:

1. **Hero** (0-20% viewport)
   - Background image move para cima (parallax)
   - Elementos flutuantes se movem independentemente
   - Opacity do overlay aumenta ligeiramente

2. **Problemas & Soluções** (20-35% viewport)
   - Cards aparecem um por um com fade-in + slide-in
   - Cada card tem delay de 100ms

3. **Funcionalidades** (35-55% viewport)
   - 6 cards em grid aparecem com parallax
   - Coluna 1: entra da esquerda
   - Coluna 2: entra do centro com scale
   - Coluna 3: entra da direita
   - Parallax diferente para cada card

4. **Como Funciona** (55-70% viewport)
   - Step numbers aparecem com rotate + fade
   - Imagens parallelam conforme scroll

5. **Recursos** (70-85% viewport)
   - Checkmarks aparecem com animação (draw animation)
   - Texto slides in

## CSS Otimizações

```css
/* Para performance em mobile */
@media (prefers-reduced-motion: reduce) {
  * {
    animation: none !important;
    transition: none !important;
  }
}

/* GPU acceleration */
.parallax-element {
  will-change: transform;
  transform: translate3d(0, 0, 0);
}

/* Smooth scroll */
html {
  scroll-behavior: smooth;
}
```

## Performance Tips

1. **Lazy Loading**: Carregar imagens sob demanda
2. **Debouncing**: Limitar calls de parallax a 16ms (60fps)
3. **useCallback**: Memoizar funções de animação
4. **Intersection Observer**: Para detectar quando elementos entram viewport
5. **Hardware Acceleration**: Usar transform3d ao invés de top/left
6. **Mobile**: Reduzir complexidade de parallax em mobile (ou desabilitar)

## Responsividade

- **Desktop**: Parallax completo com todos os efeitos
- **Tablet**: Reduzir complexidade, manter paralllax principal
- **Mobile**: Simplificar ou desabilitar parallax (apenas scroll normal)
  - Manter animações de entrada (fade-in, slide-in)
  - Manter counters animados
  - Desabilitar elementos flutuantes complexos

## Exemplo de Animação Framer Motion

```jsx
const HeroSection = () => {
  const { scrollY } = useScroll();
  const yParallax = useTransform(scrollY, [0, 500], [0, 150]);

  return (
    <motion.div
      className="hero"
      style={{ y: yParallax }}
    >
      {/* Content */}
    </motion.div>
  );
};
```

## Testing

- Testar em navegadores modernos (Chrome, Firefox, Safari, Edge)
- Testar parallax em diferentes velocidades de scroll
- Testar animações em dispositivos com "prefers-reduced-motion"
- Performance em Mobile (throttle CPU na DevTools)
- Acessibilidade: Garantir que animações não prejudiquem legibilidade

---

Boa sorte! 🚀 Use essas instruções como referência ao instruir o Loveable.
