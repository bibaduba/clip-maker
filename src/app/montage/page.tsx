import { AppShell } from '@/components/app-shell';
import styles from './page.module.scss';
import { MontageForm } from '@/components/montage-form';
import { RecentProjects } from '@/components/recent-projects';

const steps = [
  { number: '01', title: 'Найти историю', text: 'Выбрать завязку, развитие, реакцию и финальный момент по речи, звуку и кадрам.' },
  { number: '02', title: 'Проверить план', text: 'Посмотреть предложенные склейки и поправить их до затратного рендера.' },
  { number: '03', title: 'Собрать монтаж', text: 'Добавить акцентные приближения, переключения ракурса, короткие субтитры и точечные эффекты.' },
];

export default function MontagePage() {
  return <AppShell active="montage"><div className={styles.page}>
    <div className={styles.eyebrow}>НОВЫЙ РЕЖИМ · ПЕРВЫЙ ПРОТОТИП</div>
    <h1>Динамичный монтаж</h1>
    <p className={styles.lead}>Отдельный сценарий для Shorts с быстрыми смысловыми склейками и выразительным финалом. Обычные нарезки останутся на своей странице.</p>
    <MontageForm />
    <div className={styles.storyboard} aria-label="Схема будущего монтажа">
      <div><span>ЗАВЯЗКА</span><strong>Зацепить</strong></div><div><span>РАЗВИТИЕ</span><strong>Ускорить</strong></div><div><span>РЕАКЦИЯ</span><strong>Показать</strong></div><div><span>ФИНАЛ</span><strong>Оставить эффект</strong></div>
    </div>
    <div className={styles.heading}><h2>Как будет работать</h2><span>Монтажный план — до рендера</span></div>
    <div className={styles.steps}>{steps.map(step => <article key={step.number}><span>{step.number}</span><h3>{step.title}</h3><p>{step.text}</p></article>)}</div>
    <p className={styles.notice}>Первый прототип строит несколько фрагментов из одного сюжета. Перед рендером можно поправить границы и включить приближение на отдельных фрагментах. Стрелки, вспышки и звуковые акценты пока не добавлены.</p>
    <section className={styles.history}><h2>Ваши монтажные проекты</h2><RecentProjects kind="montage" /></section>
  </div></AppShell>;
}
