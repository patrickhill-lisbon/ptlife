-- PTLife Database
-- Seed: Categories
--
-- Stable top-level event categories used by PTLife.

INSERT INTO categories (
    id,
    slug,
    name_english,
    name_portuguese,
    sort_order,
    status
) VALUES
    (1,  'music',               'Music',                 'Música',                    10,  'active'),
    (2,  'art-museums',         'Art & Museums',         'Arte e Museus',             20,  'active'),
    (3,  'film',                'Film',                  'Cinema',                    30,  'active'),
    (4,  'theatre-performance', 'Theatre & Performance', 'Teatro e Espetáculos',      40,  'active'),
    (5,  'dance',               'Dance',                 'Dança',                     50,  'active'),
    (6,  'outdoors-hiking',     'Outdoors & Hiking',     'Ar Livre e Caminhadas',      60,  'active'),
    (7,  'talks-learning',      'Talks & Learning',      'Palestras e Aprendizagem',   70,  'active'),
    (8,  'food-wine',           'Food & Wine',           'Gastronomia e Vinho',        80,  'active'),
    (9,  'social-community',    'Social & Community',    'Social e Comunidade',         90,  'active'),
    (10, 'tours-history',       'Tours & History',       'Passeios e História',        100, 'active'),
    (11, 'classes-workshops',   'Classes & Workshops',   'Aulas e Workshops',          110, 'active');
