// Contenido del reto: temas diarios y medallas.
// El índice de cada tema en PROMPTS es su identificador estable (se guarda en cada recuerdo),
// así que agrega temas nuevos siempre al final de la lista.

export const TYPES = {
  drawing:    { label: 'Dibujo',     plural: 'Dibujos',    emoji: '🎨' },
  writing:    { label: 'Escritura',  plural: 'Escritura',  emoji: '📝' },
  multimedia: { label: 'Multimedia', plural: 'Multimedia', emoji: '📸' },
};

export const PROMPTS = [
  // DIBUJOS
  { type: 'drawing', title: 'Primer beso', description: 'Recuerda ese momento donde todo comenzó. ¿Cómo se vieron el uno al otro?' },
  { type: 'drawing', title: 'Risa contagiosa', description: 'Dibuja ese momento donde se rieron sin control.' },
  { type: 'drawing', title: 'Manos juntas', description: 'Captura cómo se sienten sus manos entrelazadas.' },
  { type: 'drawing', title: 'Mirada cómplice', description: 'Ese instante silencioso donde todo se dice sin palabras.' },
  { type: 'drawing', title: 'Abrazo nocturno', description: 'Dibuja cómo se sienten acurrucados bajo las sábanas.' },
  { type: 'drawing', title: 'Baile en la cocina', description: 'Ese momento improvisado donde bailaron sin música.' },
  { type: 'drawing', title: 'Viaje recordado', description: 'Ilustra el destino que más significó para ustedes.' },
  { type: 'drawing', title: 'Detalle favorito', description: 'Dibuja lo que más te fascina de tu pareja: un gesto, una expresión.' },
  { type: 'drawing', title: 'En el carro', description: 'Ese viaje en carro donde pasó algo especial.' },
  { type: 'drawing', title: 'Lluvia juntos', description: 'Un momento bajo la lluvia que los une.' },
  { type: 'drawing', title: 'Noche de estrellas', description: 'Una noche en la que vieron las estrellas juntos.' },
  { type: 'drawing', title: 'Beso de madrugada', description: 'Dibuja un beso en un momento inesperado.' },
  { type: 'drawing', title: 'Silueta al atardecer', description: 'Ustedes recortados contra un atardecer memorable.' },
  { type: 'drawing', title: 'Expresión de amor', description: 'La cara que hace tu pareja cuando te mira con amor.' },

  // ESCRITURA
  { type: 'writing', title: 'Primera impresión', description: '¿Qué sentiste la primera vez que viste a tu pareja? ¿Qué pensaste?' },
  { type: 'writing', title: 'Una conversación que cambió todo', description: 'Describe un diálogo que los acercó.' },
  { type: 'writing', title: 'Mi persona favorita', description: 'Escribe una carta corta explicando por qué es tu persona favorita.' },
  { type: 'writing', title: 'Nuestra canción', description: '¿Hay una canción que los define? Cuenta cuál es y por qué.' },
  { type: 'writing', title: 'Momento de vulnerabilidad', description: 'Un instante en que se mostraron completamente sin filtro.' },
  { type: 'writing', title: 'Promesa del futuro', description: '¿Qué sueño tienen juntos?' },
  { type: 'writing', title: 'Superando el reto', description: 'Describe un momento difícil que superaron juntos.' },
  { type: 'writing', title: 'Rituales nuestros', description: '¿Cuáles son las pequeñas cosas que hacen juntos que nadie más entiende?' },
  { type: 'writing', title: 'Carta de gratitud', description: 'Escribe qué cambió en tu vida desde que están juntos.' },
  { type: 'writing', title: 'Diálogo sin censura', description: 'Transcribe una conversación memorable o divertida.' },
  { type: 'writing', title: 'Razón para elegir', description: '¿Por qué elegiste estar con tu pareja? ¿Qué te conquistó?' },
  { type: 'writing', title: 'Miedo y valor', description: 'Escribe sobre un momento en que tuvieron miedo juntos.' },
  { type: 'writing', title: 'Sueño compartido', description: 'Describe un futuro ideal para ustedes.' },

  // MULTIMEDIA
  { type: 'multimedia', title: 'Foto de archivo + historia', description: 'Busca una foto antigua y cuenta qué pasaba ese día.' },
  { type: 'multimedia', title: 'Video corto', description: '15 a 30 segundos de un momento que estén compartiendo hoy.' },
  { type: 'multimedia', title: 'Collage de momentos', description: 'Reúne 3 a 5 fotos de diferentes épocas en una sola imagen.' },
  { type: 'multimedia', title: 'Canción + momento', description: 'Pon una canción que los represente y describan el momento que les evoca.' },
  { type: 'multimedia', title: 'Foto de hoy', description: 'Tómense una foto (puede ser selfie) con el ánimo de hoy.' },
  { type: 'multimedia', title: 'Montaje de detalles', description: 'Fotos de cerca de cosas que los unen: un anillo, una taza, una comida.' },
  { type: 'multimedia', title: 'Línea del tiempo visual', description: '4 a 6 fotos que muestren cómo han cambiado juntos.' },
  { type: 'multimedia', title: 'Lugar especial', description: 'Foto del lugar que más significa para ustedes.' },
  { type: 'multimedia', title: 'Video documental', description: 'Hasta 30 segundos contando una anécdota divertida o memorable.' },
  { type: 'multimedia', title: 'Historia en fotos', description: 'Una serie de fotos que cuenten una pequeña historia.' },
  { type: 'multimedia', title: 'Foto del espejo', description: 'Su reflejo juntos en un espejo especial.' },
  { type: 'multimedia', title: 'Antes y después', description: 'Foto de hace años vs. foto de hoy: mismo lugar, misma pose.' },
  { type: 'multimedia', title: 'Manos enlazadas', description: 'Video o foto de solo sus manos juntas mientras hablan.' },
];

// Las medallas por tipo cuentan días completados con un tema de ese tipo.
// El calendario reparte ~11 días de dibujo, ~10 de escritura y ~10 de multimedia,
// así que la última medalla de cada tipo pide completar todos esos días.
export const MEDALS = {
  drawing: [
    { name: 'Primeros trazos', icon: '✨', goal: 2, phrase: 'Cada trazo de tu mano es un testimonio de nuestro amor. Tus dibujos son ventanas a tu alma, y me encanta lo que veo.' },
    { name: 'Colores de nosotros', icon: '🌈', goal: 5, phrase: 'Tu creatividad es como un arcoíris en mi vida. Cada color representa un momento especial que compartimos.' },
    { name: 'Galería íntima', icon: '🖼️', goal: 8, phrase: 'Has creado una galería de momentos que van directo a mi corazón. Tu talento me inspira cada día a amarte más.' },
    { name: 'Obra maestra', icon: '🎭', goal: 10, phrase: 'Eres la obra maestra más hermosa que he conocido. Tus dibujos, como tu amor, son infinitos y perfectos.' },
  ],
  writing: [
    { name: 'Primeras palabras', icon: '✏️', goal: 2, phrase: 'Tus palabras son el idioma más hermoso que he escuchado. Cada frase tuya toca mi corazón como nada más puede.' },
    { name: 'Capítulo escrito', icon: '📖', goal: 5, phrase: 'Cada historia que escribes es un capítulo precioso en nuestro libro de amor. Tus palabras son la banda sonora de mi vida.' },
    { name: 'Novela en construcción', icon: '📚', goal: 7, phrase: 'Estamos escribiendo la novela más hermosa juntos. Tus palabras son mi inspiración, mi razón, mi todo.' },
    { name: 'Nuestra historia', icon: '💫', goal: 10, phrase: 'Has escrito la historia más perfecta con tu amor y dedicación. Nuestro libro nunca terminará, porque cada día es una nueva página de felicidad.' },
  ],
  multimedia: [
    { name: 'Momentos capturados', icon: '🎬', goal: 2, phrase: 'Cada foto, cada video es un momento sagrado congelado en el tiempo. Tu belleza en cada cuadro es mi película favorita.' },
    { name: 'Película de nosotros', icon: '🎞️', goal: 5, phrase: 'Somos la película de amor más hermosa jamás contada. Cada escena contigo es un clásico que atesoro eternamente.' },
    { name: 'Reel de recuerdos', icon: '🎥', goal: 7, phrase: 'Tu presencia en cada recuerdo es lo que lo hace especial. Eres la estrella de mi vida en cada fotograma.' },
    { name: 'Álbum infinito', icon: '♾️', goal: 10, phrase: 'Hemos llenado un álbum infinito de amor, risas y momentos mágicos. Contigo, cada día es una película de cuento de hadas.' },
  ],
};

// Medallas "Juntos": días en los que ambos agregaron un recuerdo.
export const TOGETHER_MEDALS = [
  { name: 'Primer día a dos', icon: '🤝', goal: 1, phrase: 'Hoy los dos dejamos una huella en el mismo día. Así quiero caminar siempre: a tu lado.' },
  { name: 'Una semana en sintonía', icon: '💞', goal: 7, phrase: 'Siete días recordando juntos. Contigo, hasta lo cotidiano se vuelve un recuerdo que vale la pena guardar.' },
  { name: 'Medio mes de nosotros', icon: '🌙', goal: 15, phrase: 'Quince días de mirarnos a través de los recuerdos. Cada uno me confirma que elegirte fue lo mejor que he hecho.' },
  { name: 'Octubre completo', icon: '💝', goal: 31, phrase: 'Un mes entero escribiendo nuestra historia a cuatro manos. Gracias por cada día, por cada recuerdo, por ser tú.' },
];
